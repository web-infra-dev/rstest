import { createPool } from '../pool';
import type { RstestContext } from '../types';
import { color, getSetupFiles, getTestEntries, logger } from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function runTests(
  context: RstestContext,
  fileFilters: string[],
): Promise<void> {
  const { rootPath, reporters, projects, snapshotManager, command } = context;

  const globTestSourceEntries = async (
    name: string,
    silent = true,
  ): Promise<Record<string, string>> => {
    const { include, exclude, includeSource, root } = projects.find(
      (p) => p.name === name,
    )!.normalizedConfig;
    const entries = await getTestEntries({
      include,
      exclude,
      includeSource,
      root,
      fileFilters,
    });

    // TODO：No test files found.
    if (!Object.keys(entries).length && !silent) {
      logger.log(color.red(`No test files found in ${name}.`));
      logger.log('');
      if (fileFilters.length) {
        logger.log(color.gray('filter: '), fileFilters.join(color.gray(', ')));
      }
      logger.log(color.gray('include:'), include.join(color.gray(', ')));
      logger.log(color.gray('exclude:'), exclude.join(color.gray(', ')));
      logger.log('');
    }

    return entries;
  };

  const globalSetupFiles = getSetupFiles(
    context.normalizedConfig.setupFiles,
    rootPath,
  );

  const setupFiles = Object.fromEntries(
    context.projects.map((project) => {
      const {
        name: projectName,
        rootPath,
        normalizedConfig: { setupFiles },
      } = project;

      return [
        projectName,
        {
          ...globalSetupFiles,
          ...getSetupFiles(setupFiles, rootPath),
        },
      ];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const { close, getRsbuildStats } = await createRsbuildServer({
    normalizedConfig: context.normalizedConfig,
    // TODO: Try not to call globTestSourceEntries again.
    globTestSourceEntries,
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const run = async () => {
    let testStart: number;
    const buildStart = Date.now();
    const returns = await Promise.all(
      context.projects.map(async (p) => {
        const { entries, setupEntries, assetFiles, sourceMaps } =
          await getRsbuildStats(p.name);

        testStart ??= Date.now();

        const pool = await createPool({
          entries,
          sourceMaps,
          setupEntries,
          assetFiles,
          context: {
            ...context,
            ...p,
          },
        });

        const { results, testResults } = await pool.runTests();

        await pool.close();

        return {
          results,
          testResults,
          sourceMaps,
        };
      }),
    );

    const buildTime = testStart! - buildStart;

    const testTime = Date.now() - testStart!;

    const duration = {
      totalTime: testTime + buildTime,
      buildTime,
      testTime,
    };

    const results = returns.flatMap((r) => r.results);
    const testResults = returns.flatMap((r) => r.testResults);
    const sourceMaps = Object.assign({}, ...returns.map((r) => r.sourceMaps));

    if (results.some((r) => r.status === 'fail')) {
      process.exitCode = 1;
    }

    for (const reporter of reporters) {
      await reporter.onTestRunEnd?.({
        results,
        testResults,
        snapshotSummary: snapshotManager.summary,
        duration,
        getSourcemap: (name: string) => sourceMaps[name] || null,
      });
    }

    return async () => {
      await close();
    };
  };

  if (command === 'watch') {
    rsbuildInstance.onDevCompileDone(async () => {
      await run();
    });
  } else {
    const close = await run();
    await close();
  }
}
