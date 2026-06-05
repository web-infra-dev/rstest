import type { createPool } from '../pool';
import type { EntryInfo, RstestContext } from '../types';
import { color, logger } from '../utils';
import type {
  ExecutorRunArgs,
  ResolveSourcemap,
  RunResult,
  TestExecutor,
} from './executor';
import { claimGlobalSetupOnce, runGlobalSetup } from './globalSetup';
import type { createRsbuildServer } from './rsbuild';

type NodePool = Awaited<ReturnType<typeof createPool>>;
type GetRsbuildStats = Awaited<
  ReturnType<typeof createRsbuildServer>
>['getRsbuildStats'];

/**
 * Wraps the node worker pool as a {@link TestExecutor}. The pool and the Rsbuild
 * server (`getRsbuildStats`) are built and owned by the run (`runTests.ts`) and
 * injected here, because their lifecycle is shared with the watch driver and the
 * granularly-ordered teardown the run still owns. This executor owns the
 * per-project run loop and `pool.close()` only.
 */
export const createNodeExecutor = ({
  context,
  pool,
  getRsbuildStats,
}: {
  context: RstestContext;
  pool: NodePool;
  getRsbuildStats: GetRsbuildStats;
}): TestExecutor => {
  const runTests = async (args: ExecutorRunArgs): Promise<RunResult> => {
    const {
      projects,
      mode,
      fileFilters,
      buildStart,
      onCoverageResult,
      onTraceEvents,
      traceSpan: span,
    } = args;
    const updateSnapshot = context.snapshotManager.options.updateSnapshot;

    let testStart: number | undefined;
    const currentEntries: EntryInfo[] = [];
    const currentDeletedEntries: string[] = [];

    const returns = await Promise.all(
      projects.map(async (p) => {
        const {
          assetNames,
          entries,
          setupEntries,
          globalSetupEntries,
          getAssetFiles,
          getSourceMaps,
          affectedEntries,
          deletedEntries,
        } = await span(
          'host:get-rsbuild-stats',
          'host',
          () =>
            getRsbuildStats({
              environmentName: p.environmentName,
              fileFilters,
            }),
          { project: p.name, testPath: '<project>' },
        );

        testStart ??= Date.now();

        // Global setup runs once per project, only if there is at least one
        // running test.
        if (
          claimGlobalSetupOnce(p, entries.length, globalSetupEntries.length)
        ) {
          const files = globalSetupEntries.flatMap((e) => e.files!);
          const globalSetupTraceArgs = {
            project: p.name,
            testPath: '<globalSetup>',
          };
          const [assetFiles, sourceMaps] = await span(
            'host:global-setup-assets',
            'host',
            () => Promise.all([getAssetFiles(files), getSourceMaps(files)]),
            globalSetupTraceArgs,
          );

          const { success, errors } = await span(
            'host:global-setup',
            'host',
            () =>
              runGlobalSetup({
                globalSetupEntries,
                assetFiles,
                sourceMaps,
                interopDefault: true,
                outputModule: p.outputModule,
              }),
            globalSetupTraceArgs,
          );
          if (!success) {
            return {
              results: [],
              testResults: [],
              errors,
              assetNames,
              // sourcemap is useless since we install source-map-support in worker
              getSourceMaps: () => null,
            };
          }
        }

        currentDeletedEntries.push(...deletedEntries);

        let finalEntries: EntryInfo[] = entries;
        if (mode === 'on-demand') {
          if (affectedEntries.length === 0) {
            logger.debug(
              color.yellow(
                `No test files need re-run in project(${p.environmentName}).`,
              ),
            );
          } else {
            logger.debug(
              color.yellow(
                `Test files to re-run in project(${p.environmentName}):\n`,
              ) +
                affectedEntries.map((e) => e.testPath).join('\n') +
                '\n',
            );
          }
          finalEntries = affectedEntries;
        } else {
          logger.debug(
            color.yellow(
              fileFilters?.length
                ? `Run filtered tests in project(${p.environmentName}).\n`
                : `Run all tests in project(${p.environmentName}).\n`,
            ),
          );
        }

        currentEntries.push(...finalEntries);
        const { results, testResults } = await pool.runTests({
          entries: finalEntries,
          getSourceMaps,
          setupEntries,
          getAssetFiles,
          project: p,
          updateSnapshot,
          onCoverageResult,
          onTraceEvents,
          traceSpan: span,
        });

        return {
          results,
          testResults,
          assetNames,
          getSourceMaps,
        };
      }),
    );

    testStart ??= buildStart;
    const buildTime = testStart - buildStart;
    const testTime = Date.now() - testStart;

    const nodeResourceByAssetName = new Map<
      string,
      (typeof returns)[number]['getSourceMaps']
    >();
    for (const item of returns) {
      for (const assetName of item.assetNames) {
        nodeResourceByAssetName.set(assetName, item.getSourceMaps);
      }
    }

    const resolveSourcemap: ResolveSourcemap = async (sourcePath) => {
      const getSourceMaps = nodeResourceByAssetName.get(sourcePath);
      const sourceMap = (await getSourceMaps?.([sourcePath]))?.[sourcePath];
      return {
        handled: nodeResourceByAssetName.has(sourcePath),
        sourcemap: sourceMap ? JSON.parse(sourceMap) : null,
      };
    };

    return {
      results: returns.flatMap((r) => r.results),
      testResults: returns.flatMap((r) => r.testResults),
      unhandledErrors: returns.flatMap((r) => r.errors || []),
      duration: {
        totalTime: testTime + buildTime,
        buildTime,
        testTime,
      },
      ranTestPaths: currentEntries.map((e) => e.testPath),
      deletedEntries: currentDeletedEntries,
      resolveSourcemap,
    };
  };

  return {
    name: 'node',
    runTests,
    close: () => pool.close(),
  };
};
