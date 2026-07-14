import { createRsbuild, logger as RsbuildLogger } from '@rsbuild/core';
import type {
  EntryInfo,
  ProjectContext,
  ProjectEntries,
  RstestContext,
} from '../types';
import { isDebug } from '../utils';
import { claimGlobalSetupOnce, runGlobalSetup } from './globalSetup';
import { getRsbuildEnvironmentConfig } from './modifyRstestConfig';
import { pluginBasic } from './plugins/basic';
import { pluginEntryWatch } from './plugins/entry';
import { pluginExternal } from './plugins/external';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';
import { pluginMockRuntime } from './plugins/mockRuntime';
import { getProjectEntries } from './projectPlan';
import { createRsbuildServer, hostServerConfig } from './rsbuild';
import { createSetupFileState } from './setupFileState';

export type BrowserGlobalSetupStageResult = {
  /**
   * Merged env change-set the browser projects' globalSetup applied to the
   * host `process.env` (later projects win). `undefined` when no setup ran,
   * so the browser wire stays byte-identical to a run without globalSetup.
   */
  env?: Record<string, string | undefined>;
  /** Setup failures; when non-empty the browser cycle must be skipped. */
  errors: Error[];
};

const emptyEntries = async () => ({});

/**
 * Core-owned pre-cycle globalSetup stage for browser projects.
 *
 * Browser projects never flow through the node Rsbuild instance, so their
 * `globalSetup` files get a dedicated one-shot node-target compile here —
 * created only when a browser project both declares `globalSetup` and has at
 * least one test entry (the cold-start gate stays intact for everyone else).
 * Setups run host-side in the same forked worker node projects use; teardown
 * callbacks queue into the shared `runGlobalTeardown` drain.
 *
 * Known restriction: browser `modifyRstestConfig` hooks apply later (inside
 * the browser run cycle), so hook-added `globalSetup` entries or hook-added
 * test files in an otherwise-empty project are invisible to this stage.
 *
 * Known limitation: browser projects share one run cycle, so any project's
 * setup failure skips the whole browser cycle (node isolates failures per
 * project). Exit code and error reporting still surface the failure.
 */
export async function runBrowserGlobalSetupStage(
  context: RstestContext,
  browserProjects: ProjectContext[],
  options?: {
    /**
     * Plan-resolved entries (mixed path) so the "no running tests -> no
     * globalSetup" gate reuses the plan's glob instead of re-walking the fs.
     */
    entriesCache?: Map<string, ProjectEntries>;
  },
): Promise<BrowserGlobalSetupStageResult> {
  const candidates = (
    await Promise.all(
      browserProjects.map(async (project) => {
        if (
          !project.normalizedConfig.globalSetup.length ||
          project._globalSetups
        ) {
          return undefined;
        }
        // Same "no running tests -> no globalSetup" gate as the node path,
        // honoring include/exclude and CLI file filters.
        const entries =
          options?.entriesCache?.get(project.environmentName)?.entries ??
          (await getProjectEntries({ context, project }));
        const entryCount = Object.keys(entries).length;
        return entryCount > 0 ? { project, entryCount } : undefined;
      }),
    )
  ).filter((candidate) => candidate !== undefined);

  if (candidates.length === 0) {
    return { errors: [] };
  }

  const setupFileState = createSetupFileState();
  setupFileState.refresh({
    setupProjects: [],
    globalSetupProjects: candidates.map(({ project }) => project),
  });

  const { dev = {} } = context.normalizedConfig;
  const debugMode = isDebug();
  RsbuildLogger.level = debugMode ? 'verbose' : 'error';

  // Same plugin set the node-target related-test graph build uses; entries are
  // fed exclusively from the globalSetup file map (source/setup maps stay
  // empty), so the compile covers the globalSetup files exactly. Pool- and
  // instrumentation-only plugins (cache control, inspect, coverage) are
  // omitted — globalSetup files are coverage-excluded on the node path too.
  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest',
    config: {
      root: context.rootPath,
      server: { ...hostServerConfig },
      dev: {
        hmr: false,
        writeToDisk: dev.writeToDisk || debugMode,
      },
      environments: Object.fromEntries(
        candidates.map(({ project }) => [
          project.environmentName,
          getRsbuildEnvironmentConfig(project),
        ]),
      ),
      plugins: [
        pluginBasic(context),
        pluginIgnoreResolveError,
        pluginMockRuntime,
        pluginEntryWatch({
          globTestSourceEntries: emptyEntries,
          setupFiles: setupFileState.setupFiles,
          globalSetupFiles: setupFileState.globalSetupFiles,
          context,
          isWatch: false,
        }),
        pluginExternal(context),
      ],
    },
  });

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    isWatchMode: false,
    rsbuildInstance,
    globTestSourceEntries: emptyEntries,
    setupFiles: setupFileState.setupFiles,
    globalSetupFiles: setupFileState.globalSetupFiles,
    rootPath: context.rootPath,
  });

  // Materialize compiled assets before closing the server so no compiler
  // lingers while user setup code runs.
  let prepared: {
    project: ProjectContext;
    entryCount: number;
    globalSetupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, string>;
  }[];
  try {
    prepared = await Promise.all(
      candidates.map(async ({ project, entryCount }) => {
        const { globalSetupEntries, getAssetFiles, getSourceMaps } =
          await getRsbuildStats({
            environmentName: project.environmentName,
          });
        const files = globalSetupEntries.flatMap((e) => e.files!);
        const [assetFiles, sourceMaps] = await Promise.all([
          getAssetFiles(files),
          getSourceMaps(files),
        ]);
        return {
          project,
          entryCount,
          globalSetupEntries,
          assetFiles,
          sourceMaps,
        };
      }),
    );
  } finally {
    await closeServer();
  }

  const envOverlay: Record<string, string | undefined> = {};
  const errors: Error[] = [];
  let ranAnySetup = false;

  for (const item of prepared) {
    if (
      !claimGlobalSetupOnce(
        item.project,
        item.entryCount,
        item.globalSetupEntries.length,
      )
    ) {
      continue;
    }
    const {
      success,
      errors: setupErrors,
      envChanges,
    } = await runGlobalSetup({
      globalSetupEntries: item.globalSetupEntries,
      assetFiles: item.assetFiles,
      sourceMaps: item.sourceMaps,
      interopDefault: true,
      outputModule: item.project.outputModule,
    });
    if (success) {
      ranAnySetup = true;
      Object.assign(envOverlay, envChanges);
    } else {
      errors.push(...(setupErrors ?? []));
    }
  }

  return { env: ranAnySetup ? envOverlay : undefined, errors };
}
