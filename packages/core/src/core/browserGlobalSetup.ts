import { createRsbuild, logger as RsbuildLogger } from '@rsbuild/core';
import type { EntryInfo, ProjectContext, RstestContext } from '../types';
import { isDebug } from '../utils';
import { getSetupFiles } from '../utils/getSetupFiles';
import { claimGlobalSetupOnce, runProjectGlobalSetup } from './globalSetup';
import { getRsbuildEnvironmentConfig } from './modifyRstestConfig';
import { pluginBasic } from './plugins/basic';
import { pluginEntryWatch } from './plugins/entry';
import { pluginExternal } from './plugins/external';
import { pluginIgnoreResolveError } from './plugins/ignoreResolveError';
import { pluginMockRuntime } from './plugins/mockRuntime';
import { getProjectEntries } from './projectPlan';
import { createRsbuildServer } from './rsbuild';

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
): Promise<BrowserGlobalSetupStageResult> {
  const candidates: { project: ProjectContext; entryCount: number }[] = [];
  for (const project of browserProjects) {
    if (!project.normalizedConfig.globalSetup.length || project._globalSetups) {
      continue;
    }
    // Same "no running tests -> no globalSetup" gate as the node path,
    // honoring include/exclude and CLI file filters.
    const entries = await getProjectEntries({ context, project });
    const entryCount = Object.keys(entries).length;
    if (entryCount > 0) {
      candidates.push({ project, entryCount });
    }
  }

  if (candidates.length === 0) {
    return { errors: [] };
  }

  const globalSetupFiles: Record<string, Record<string, string>> = {};
  for (const { project } of candidates) {
    globalSetupFiles[project.environmentName] = getSetupFiles(
      project.normalizedConfig.globalSetup,
      project.rootPath,
    );
  }

  const { dev = {} } = context.normalizedConfig;
  const debugMode = isDebug();
  RsbuildLogger.level = debugMode ? 'verbose' : 'error';

  // Same plugin set the node-target related-test graph build uses; entries are
  // fed exclusively from `globalSetupFiles` (source/setup maps stay empty), so
  // the compile covers the globalSetup files exactly. Pool- and
  // instrumentation-only plugins (cache control, inspect, coverage) are
  // omitted — globalSetup files are coverage-excluded on the node path too.
  const rsbuildInstance = await createRsbuild({
    callerName: 'rstest',
    config: {
      root: context.rootPath,
      server: {
        printUrls: false,
        strictPort: false,
        middlewareMode: true,
        compress: false,
        cors: false,
        publicDir: false,
      },
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
          setupFiles: {},
          globalSetupFiles,
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
    setupFiles: {},
    globalSetupFiles,
    rootPath: context.rootPath,
  });

  // Materialize compiled assets before closing the server so no compiler
  // lingers while user setup code runs.
  const prepared: {
    project: ProjectContext;
    entryCount: number;
    globalSetupEntries: EntryInfo[];
    assetFiles: Record<string, string>;
    sourceMaps: Record<string, string>;
  }[] = [];
  try {
    for (const { project, entryCount } of candidates) {
      const { globalSetupEntries, getAssetFiles, getSourceMaps } =
        await getRsbuildStats({
          environmentName: project.environmentName,
        });
      const files = globalSetupEntries.flatMap((e) => e.files!);
      const [assetFiles, sourceMaps] = await Promise.all([
        getAssetFiles(files),
        getSourceMaps(files),
      ]);
      prepared.push({
        project,
        entryCount,
        globalSetupEntries,
        assetFiles,
        sourceMaps,
      });
    }
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
    } = await runProjectGlobalSetup({
      project: item.project,
      globalSetupEntries: item.globalSetupEntries,
      getAssetFiles: async () => item.assetFiles,
      getSourceMaps: async () => item.sourceMaps,
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
