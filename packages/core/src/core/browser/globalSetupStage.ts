import { createRsbuild, logger as RsbuildLogger } from '@rsbuild/core';
import { normalize } from 'pathe';
import type {
  EntryInfo,
  ExecutorCycleOutcome,
  InternalContext,
  InternalProjectContext,
  ProjectEntries,
} from '../../types';
import { isDebug, resolveShardedEntries } from '../../utils';
import { shouldRunGlobalSetup, runGlobalSetup } from '../globalSetup';
import {
  getRsbuildEnvironmentConfig,
  initModifyRstestConfigHooks,
} from '../modifyRstestConfig';
import { getProjectEntries } from '../projectPlan';
import { pluginBasic } from '../plugins/basic';
import { pluginEntryWatch } from '../plugins/entry';
import { pluginExternal } from '../plugins/external';
import { pluginIgnoreResolveError } from '../plugins/ignoreResolveError';
import { pluginMockRuntime } from '../plugins/mockRuntime';
import { createRsbuildServer, hostServerConfig } from '../rsbuild';
import { createSetupFileState } from '../setupFileState';

export type BrowserGlobalSetupStageResult = {
  /**
   * Merged env change-set the browser projects' globalSetup applied to the
   * run context (later projects win). `undefined` when no setup ran,
   * so the browser wire stays byte-identical to a run without globalSetup.
   */
  env?: Record<string, string | undefined>;
  /** Setup failures; when non-empty the browser cycle must be skipped. */
  errors: Error[];
  /**
   * The real files this stage compiled — the `globalSetup` entries plus the
   * project sources they import — for a caller that has to watch them (see
   * `createBrowserSetupGate`). Virtual `data:` entries are left out: they are
   * materialized under `.rstest-virtual/` and never exist on disk. Only
   * collected when the stage failed; nothing watches a setup that succeeded.
   */
  setupPaths?: string[];
};

const emptyEntries = async () => ({});

/**
 * Errors-only outcome fed into the shared finalize when the pre-cycle browser
 * globalSetup stage fails — same error objects and exit-code path as a node
 * in-cycle globalSetup failure.
 */
export const globalSetupFailureOutcome = (
  errors: Error[],
): ExecutorCycleOutcome => ({
  results: [],
  testResults: [],
  errors,
  testPaths: [],
  duration: { buildTime: 0, testTime: 0 },
});

/**
 * Core-owned pre-cycle globalSetup stage for browser projects.
 *
 * Browser projects never flow through the node Rsbuild instance, so their
 * `globalSetup` files get a dedicated one-shot node-target compile here —
 * created only when a browser project declares `globalSetup` and either has
 * at least one test entry or starts a watch session.
 * Setups run host-side in the same forked worker node projects use; teardown
 * callbacks queue into the shared `runGlobalTeardown` drain.
 *
 * Hook-added config is visible here: the planner's config-hook discovery has
 * already fired the browser `modifyRstestConfig` hooks and re-resolved the
 * plan by the time any run shape reaches this stage, so `globalSetup` entries
 * a hook added — and hook-added test files in an otherwise-empty project —
 * are honored. The public `global-setup` docs state the same guarantee; keep
 * the two in step.
 *
 * Known limitation: browser projects share one run cycle, so any project's
 * setup failure skips the whole browser cycle (node isolates failures per
 * project). Exit code and error reporting still surface the failure.
 *
 */
export async function runBrowserGlobalSetupStage(
  context: InternalContext,
  browserProjects: InternalProjectContext[],
  {
    entriesCache,
    watch,
  }: {
    /** Watch sessions outlive the initial file set; non-watch keeps the no-entries gate. */
    watch?: boolean;
    /**
     * The plan's entries, already narrowed to the shard slice, so the "no
     * running tests -> no globalSetup" gate reuses the plan's glob instead of
     * re-walking the fs. When present it is authoritative — an absent project
     * means zero entries, not "look it up". Optional because `listTests.ts`
     * reaches this stage without a resolved plan; every run shape comes through
     * the one assembly in `runTests.ts` and always passes it.
     */
    entriesCache?: Map<string, ProjectEntries>;
  },
): Promise<BrowserGlobalSetupStageResult> {
  // Shard-aware outside watch: the run path passes the plan's
  // shard-narrowed cache; a list without one resolves the same sharded map the
  // browser controller will use, so a project whose shard slice is empty never
  // runs its globalSetup. Only an unsharded list falls back to a per-project
  // glob.
  const gateEntries = entriesCache ?? (await resolveShardedEntries(context));

  const candidates = (
    await Promise.all(
      browserProjects.map(async (project) => {
        if (
          !project.normalizedConfig.globalSetup.length ||
          project._globalSetups
        ) {
          return undefined;
        }
        // Non-watch keeps the "no running tests -> no globalSetup" gate,
        // honoring include/exclude, CLI file filters, and sharding.
        const entries = gateEntries
          ? (gateEntries.get(project.environmentName)?.entries ?? {})
          : await getProjectEntries({
              context,
              project,
              fileFilters: context.fileFilters,
            });
        const entryCount = Object.keys(entries).length;
        return watch || entryCount > 0 ? { project, entryCount } : undefined;
      }),
    )
  ).filter((candidate) => candidate !== undefined);

  if (candidates.length === 0) {
    return { errors: [] };
  }

  const candidateProjects = candidates.map(({ project }) => project);
  const setupFileState = createSetupFileState();
  setupFileState.refresh({
    setupProjects: [],
    globalSetupProjects: candidateProjects,
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
        candidateProjects.map((project) => [
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
          virtualModules: setupFileState.virtualModules,
          context,
          isWatch: false,
        }),
        pluginExternal(context),
      ],
    },
  });

  initModifyRstestConfigHooks(
    context,
    rsbuildInstance,
    candidateProjects,
    candidateProjects,
    {
      // Discovery already applied these callbacks. This compile only needs to
      // expose the settled project config before user plugin setup runs.
      appliedEnvironmentNames: new Set(
        candidateProjects.map((project) => project.environmentName),
      ),
    },
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    isWatchMode: false,
    rsbuildInstance,
    globTestSourceEntries: emptyEntries,
    setupFiles: setupFileState.setupFiles,
    globalSetupFiles: setupFileState.globalSetupFiles,
    rootPath: context.rootPath,
  });

  // The graph adds the helpers the entries import, which is the only way a fix
  // to one of those retries a failed stage. Dependencies outside both roots or
  // inside `node_modules` are dropped: the watcher polls, and neither is what a
  // user edits to fix a setup. The bound is either root because neither contains
  // the other in general — a project may be rooted outside the runner root, and
  // a project rooted at a monorepo subdirectory may import a shared helper from
  // elsewhere under that root.
  const runnerPrefix = `${normalize(context.rootPath)}/`;

  // Materialize compiled assets before closing the server so no compiler
  // lingers while user setup code runs.
  let prepared: {
    project: InternalProjectContext;
    entryCount: number;
    globalSetupEntries: EntryInfo[];
    assetFiles: Record<string, Buffer>;
    sourceMaps: Record<string, string>;
    dependencies: string[];
  }[];
  try {
    prepared = await Promise.all(
      candidates.map(async ({ project, entryCount }) => {
        const {
          globalSetupEntries,
          getAssetFiles,
          getSourceMaps,
          getFileDependencies,
        } = await getRsbuildStats({
          environmentName: project.environmentName,
        });
        const files = globalSetupEntries.flatMap((e) => e.files!);
        const [assetFiles, sourceMaps] = await Promise.all([
          getAssetFiles(files),
          getSourceMaps(files),
        ]);
        const projectPrefix = `${normalize(project.rootPath)}/`;
        return {
          project,
          entryCount,
          globalSetupEntries,
          assetFiles,
          sourceMaps,
          dependencies: getFileDependencies()
            .map((dependency) => normalize(dependency))
            .filter(
              (filePath) =>
                (filePath.startsWith(projectPrefix) ||
                  filePath.startsWith(runnerPrefix)) &&
                !filePath.includes('/node_modules/'),
            ),
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
      !shouldRunGlobalSetup(
        item.project,
        watch ? Math.max(1, item.entryCount) : item.entryCount,
        item.globalSetupEntries.length,
      )
    ) {
      continue;
    }
    const {
      success,
      errors: setupErrors,
      envChanges,
    } = await runGlobalSetup(context, item.project, {
      globalSetupEntries: item.globalSetupEntries,
      assetFiles: item.assetFiles,
      sourceMaps: item.sourceMaps,
      interopDefault: true,
      outputModule: item.project.outputModule,
      federation: item.project.normalizedConfig.federation,
    });
    if (success) {
      ranAnySetup = true;
      Object.assign(envOverlay, envChanges);
    } else {
      errors.push(...(setupErrors ?? []));
    }
  }

  const env = ranAnySetup ? envOverlay : undefined;
  if (!errors.length) {
    return { env, errors };
  }

  const virtualPaths = new Set(
    Object.values(setupFileState.virtualModules).flatMap((modules) =>
      Object.keys(modules),
    ),
  );
  // The entries belong in the set even when the compile produced no usable
  // graph (a syntax error in the entry itself).
  const setupPaths = new Set([
    ...setupFileState.getSetupPaths(),
    ...prepared.flatMap((item) => item.dependencies),
  ]);

  return {
    env,
    errors,
    setupPaths: [...setupPaths].filter(
      (setupPath) => !virtualPaths.has(setupPath),
    ),
  };
}
