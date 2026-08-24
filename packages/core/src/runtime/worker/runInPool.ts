import type { FileCoverageData } from 'istanbul-lib-coverage';
import { createContext, runInContext, Script, type Context } from 'node:vm';
import { isMainThread, threadId } from 'node:worker_threads';
import { normalize } from 'pathe';
import { install } from 'source-map-support';
import type {
  AssetFiles,
  MaybePromise,
  RunnerHooks,
  RunWorkerOptions,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import type { TestEnvironmentModuleFallback } from '../../pool/protocol';
import { getAssetText } from '../../utils/assetFiles';
import {
  RSTEST_API_GLOBAL_KEY,
  RSTEST_IMPORT_META_GLOBAL_KEY,
} from '../../utils/constants';
import { getFileTaskId } from '../../utils/helper';
import { color } from '../../utils/logger';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import type { FileCleanupHooks } from '../runner';
import { cleanupWorkerFixtures } from '../runner/fixtures';
import { createAsyncLeakDetector } from './asyncLeaks';
import { environmentLoaders } from './env/registry';
import { loadTestEnvironmentModule } from './env/testEnvironmentModule';
import { installGlobalApis, installGlobalProperty } from './globalProperty';
import { PhaseTracker } from './phaseTracker';
import { createRuntimeRpc, createWorkerRpcOptions } from './rpc';
import { setFederationDynamicImportOrigin } from './runtimeHooks';
import { createSilentConsoleController } from './silentConsole';
import { RstestSnapshotEnvironment } from './snapshot';
import { createNodeTaskContext } from './taskContext.node';
import type { TaskContext } from './taskContext';

let sourceMaps: Record<string, string> = {};

// Threads-pool workers all share `process.pid` with the host, and each
// worker_thread has its own JS context, so PhaseTracker's `nextThreadId`
// restarts at 1 inside every thread. Without a synthetic pid the merged
// Perfetto trace would collapse multiple threads onto the same `(pid, tid)`
// track and misattribute timing. Forks workers run as the main thread of a
// child_process and keep the real `process.pid`.
const tracePid = isMainThread ? undefined : process.pid * 1_000_000 + threadId;

// provides source map support for stack traces
install({
  environment: 'node',
  handleUncaughtExceptions: false,
  retrieveSourceMap: (source) => {
    if (sourceMaps[source]) {
      return {
        url: source,
        map: JSON.parse(sourceMaps[source]),
      };
    }
    return null;
  },
});

/**
 * Restores task-scoped global mutations at the next task boundary, rather than
 * file teardown, so late callbacks keep the console and RPC they captured.
 * Console interception and optional global APIs register their inverses here
 * before a reused worker can serve another project.
 */
const globalCleanups: (() => void)[] = [];
let isTeardown = false;
/**
 * Test environment kept alive across files on a reused worker
 * (`isolate: false`).
 *
 * User modules persist per worker under `isolate: false` (#1373), and a
 * persisted module may capture environment values at evaluation time —
 * testing-library's `screen` binds `document.body` once, at import. The
 * environment must therefore live exactly as long as the module registry, or
 * such captures dangle on a torn-down window from the second file on. This is
 * the same staleness class #1376 solved for context-bound core APIs via live
 * bindings — an option third-party modules do not have, so here the
 * environment's lifetime moves instead.
 *
 * A worker only ever holds one environment: the scheduler restricts reuse to
 * tasks whose `environmentKey` matches (`Pool.acquireRunner`). No
 * teardown runs at worker exit — the host owns termination (see
 * `pool/AGENTS.md`) and process death reclaims the environment, same as the
 * kept module cache.
 */
let activeEnvironmentKey: string | undefined;
/**
 * Last per-compile `buildId` this (possibly reused) worker loaded; a change
 * means a watch rebuild and triggers a full cache flush below (#1373).
 *
 * Invariant the `isolate: false` cache sharing rests on: `buildId` is a single
 * `run()`-scoped counter shared by every concurrently-dispatched project, so a
 * reused worker serving project A→B→A within one round sees an identical
 * `buildId` for all of them — the full flush fires exactly once per rebuild,
 * never spuriously between sibling projects. If `buildId` ever became
 * per-project, this single module-global would ping-pong between concurrent
 * projects on a reused worker and flush mid-round, evicting a sibling's live
 * runtime chunk and reintroducing the cross-project regression (#1376).
 */
let lastBuildId: number | undefined;

const setErrorName = (error: Error, type: string): Error => {
  try {
    error.name = type;
    return error;
  } catch {
    try {
      Object.defineProperty(error, 'name', {
        value: type,
        configurable: true,
      });
      return error;
    } catch {
      const fallbackError = new Error(error.message);
      fallbackError.name = type;
      fallbackError.stack = error.stack;
      return fallbackError;
    }
  }
};

const setupEnv = (env?: Partial<NodeJS.ProcessEnv>) => {
  if (env) {
    Object.entries(env).forEach(([key, value]) => {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    });
  }
};

const installVmNodeGlobals = (runtimeGlobal: Record<string, any>): void => {
  const excluded = new Set(['GLOBAL', 'root', 'global', 'globalThis']);
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (excluded.has(key) || key in runtimeGlobal) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      Object.defineProperty(runtimeGlobal, key, descriptor);
    }
  }

  Object.assign(runtimeGlobal, {
    process,
    Buffer,
    ArrayBuffer,
    Uint8Array,
    global: runtimeGlobal,
    setImmediate,
    clearImmediate,
  });
};

const captureVmContextKeysScript = new Script(
  'Object.getOwnPropertyNames(globalThis).concat(Object.getOwnPropertySymbols(globalThis))',
);
const stripVmContextScript = new Script(`(initialKeys) => {
  const globalObject = globalThis;
  try { globalObject.document.body.textContent = ''; } catch {}
  try { globalObject.document.head.textContent = ''; } catch {}
  let keys = [];
  try {
    keys = Object.getOwnPropertyNames(globalObject).concat(Object.getOwnPropertySymbols(globalObject));
  } catch {}
  for (const key of keys) {
    if (initialKeys.has(key)) continue;
    try { delete globalObject[key]; } catch {}
  }
}`);

const captureVmContextKeys = (context: Context): Set<string | symbol> => {
  try {
    return new Set(captureVmContextKeysScript.runInContext(context));
  } catch {
    return new Set();
  }
};

const stripVmContext = (
  context: Context,
  initialKeys: Set<string | symbol>,
): void => {
  try {
    stripVmContextScript.runInContext(context)(initialKeys);
  } catch {
    // The context may already be in the process of being torn down.
  }
};

const createOriginalLogWriter = () => {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const stderrWrite = process.stderr.write.bind(process.stderr);

  return ({
    content,
    type,
  }: {
    content: string;
    type: 'stderr' | 'stdout';
  }) => {
    if (type === 'stderr') {
      stderrWrite(content);
      return;
    }

    stdoutWrite(content);
  };
};

const preparePool = async (
  {
    entryInfo: { distPath, testPath },
    updateSnapshot,
    context,
    environmentKey,
  }: RunWorkerOptions['options'],
  tracker?: PhaseTracker,
  onTestEnvironmentFallback?: (fallback: TestEnvironmentModuleFallback) => void,
) => {
  // Reset globalCleanups only when preparePool is called again (running without isolation)
  globalCleanups.forEach((fn) => {
    fn();
  });
  globalCleanups.length = 0;

  const taskContext = createNodeTaskContext();
  const writeOriginalLog = createOriginalLogWriter();
  setRealTimers();

  const cleanupFns: (() => MaybePromise<void>)[] = [];
  const isVmPool = context.pool === 'vmThreads';
  let vmContext: Context | undefined;
  let initialVmContextKeys: Set<string | symbol> | undefined;
  let runtimeGlobal = globalThis as Record<string, any>;

  const disposeFns: (() => void)[] = [];
  const { rpc } = createRuntimeRpc(
    createWorkerRpcOptions({ dispose: disposeFns }),
  );

  globalCleanups.push(() => {
    disposeFns.forEach((fn) => {
      fn();
    });
    rpc.$close();
  });

  const {
    runtimeConfig: {
      globals,
      printConsoleTrace,
      disableConsoleIntercept,
      silent,
      testEnvironment,
      snapshotFormat,
      env,
      isolate,
    },
  } = context;

  setupEnv(env);

  if (isVmPool) {
    if (testEnvironment.name === 'node') {
      vmContext = createContext({});
    } else {
      const loadEnvironment = environmentLoaders[testEnvironment.name];
      if (!loadEnvironment) {
        throw new Error(`Unknown test environment: ${testEnvironment.name}`);
      }
      const [{ setupVM }, environmentModule] = await Promise.all([
        loadEnvironment(),
        loadTestEnvironmentModule(
          context.testEnvironmentModule,
          onTestEnvironmentFallback,
        ),
      ]);
      const vmEnvironment = await setupVM(
        testEnvironment.options || {},
        { scope: 'file' },
        environmentModule,
      );
      vmContext = vmEnvironment.context;
      cleanupFns.push(vmEnvironment.teardown);
    }
    runtimeGlobal = runInContext('globalThis', vmContext!) as Record<
      string,
      any
    >;
    installVmNodeGlobals(runtimeGlobal);
    initialVmContextKeys = captureVmContextKeys(vmContext);
  }

  // `mockRuntimeCode.js` gates its Module Federation shims on this worker-wide
  // flag, so it must be set before any bundle code is evaluated.
  const federation = context.runtimeConfig.federation === true;
  runtimeGlobal.__rstest_federation__ = federation;
  // With `isolate: false` a previous file in this worker may have installed the
  // global dynamic-import fallback (`mockRuntimeCode.js`). Hide it from
  // non-federation files so federation stays strictly opt-in, and hand it back
  // on federation re-entry — the installing runtime chunk is kept across files
  // and never re-executes, so dropping it outright would be permanent.
  setFederationDynamicImportOrigin(federation, testPath, runtimeGlobal);

  const shouldInterceptConsole =
    !disableConsoleIntercept || silent === true || silent === 'passed-only';

  const silentConsoleController = createSilentConsoleController({
    runtimeConfig: {
      disableConsoleIntercept,
      silent,
    },
    emitInterceptedLog: (log) => {
      // Forwarding console output to the host is best-effort, fire-and-forget:
      // the result is never awaited. With `isolate: false` a captured console
      // (e.g. a logger that flushes from a late `setTimeout`/microtask) can fire
      // after this file's birpc channel has been closed or disposed by the host,
      // so the call rejects — immediately once the channel is `$close()`d, or
      // later when `$close()` rejects the still-pending request. Swallowing it
      // drops such an orphan log instead of surfacing an `unhandledRejection`
      // that fails the run and is misattributed to whichever file is currently
      // running. A dropped late log also stays subject to the host's
      // `onConsoleLog` policy, matching `isolate: true` where late logs are lost
      // as the worker is torn down.
      // See https://github.com/web-infra-dev/rstest/issues/1367.
      void rpc.onConsoleLog(log).catch(() => {
        // Worker-scoped cleanup runs after the host has disposed the final
        // task RPC. Preserve diagnostics from that cleanup by falling back to
        // the worker's original stream when the reporting channel is closed.
        if (silent !== true) {
          writeOriginalLog({
            content: `${log.content}\n`,
            type: log.type,
          });
        }
      });
    },
    writeOriginalLog,
  });

  if (shouldInterceptConsole) {
    const { createCustomConsole } = await import('./console');

    // Keep a minimal internal interception path when `silent` is enabled.
    // In `disableConsoleIntercept + silent` mode, logs are buffered in the
    // worker first and later replayed to the original worker streams according
    // to the silent policy, instead of being reported to the host.

    const customConsole = createCustomConsole({
      onConsoleLog: (log) => {
        silentConsoleController.onConsoleLog(log);
      },
      testPath,
      project: context.project,
      printConsoleTrace: !disableConsoleIntercept && printConsoleTrace,
      getCurrentTask: () => taskContext.getCurrent(),
    });
    globalCleanups.push(
      installGlobalProperty(runtimeGlobal, 'console', customConsole),
    );
  }

  const interopDefault = true;

  const workerState: WorkerState = {
    ...context,
    snapshotOptions: {
      updateSnapshot,
      snapshotEnvironment: new RstestSnapshotEnvironment({
        resolveSnapshotPath: (filepath: string) =>
          rpc.resolveSnapshotPath(filepath),
      }),
      snapshotFormat,
    },
    distPath,
    testPath,
    environment: 'node',
  };

  const { createRstestRuntime } = await import('../api');

  const unhandledErrors: Error[] = [];

  const handleError = (e: Error | string, type: string) => {
    const rawError: Error = typeof e === 'string' ? new Error(e) : e;
    const error =
      !rawError.name || rawError.name === 'Error'
        ? setErrorName(rawError, type)
        : rawError;

    if (isTeardown) {
      error.stack = `${color.yellow('Caught error after test environment was torn down:')}\n\n${error.stack}`;
      console.error(error);
    } else {
      console.error(error);
      unhandledErrors.push(error);
    }
  };

  const uncaughtException = (e: Error) => handleError(e, 'uncaughtException');
  const unhandledRejection = (e: Error) => handleError(e, 'unhandledRejection');

  process.on('uncaughtException', uncaughtException);
  process.on('unhandledRejection', unhandledRejection);

  globalCleanups.push(() => {
    process.off('uncaughtException', uncaughtException);
    process.off('unhandledRejection', unhandledRejection);
  });

  const { api, resolveImportMetaRstest, runner } = await createRstestRuntime(
    workerState,
    {
      taskContext,
    },
  );

  tracker?.transition('envSetup');
  const hasPinnedEnvironment = !isVmPool && activeEnvironmentKey !== undefined;
  if (hasPinnedEnvironment && activeEnvironmentKey !== environmentKey) {
    // Unreachable: the scheduler only reuses a worker for tasks matching its
    // pinned environment (`Pool.acquireRunner`). The throw guards against a
    // future regression in that affinity — swapping environments here would
    // leave persisted modules holding captures of the previous one.
    throw new Error(
      `Test environment changed on a reused worker: ${activeEnvironmentKey} -> ${environmentKey}`,
    );
  }
  // `node` is the no-op fast path; every other environment is resolved through
  // the registry so adding one is a single entry instead of a new switch arm.
  // teardown is `MaybePromise<void>` and is awaited via `Promise.all` in
  // `cleanup`, so a single uniform wrapper preserves both the sync (jsdom) and
  // async (happy-dom) teardown shapes.
  if (!isVmPool && testEnvironment.name !== 'node' && !hasPinnedEnvironment) {
    const loadEnvironment = environmentLoaders[testEnvironment.name];
    if (!loadEnvironment) {
      throw new Error(`Unknown test environment: ${testEnvironment.name}`);
    }
    const scope = isolate ? 'file' : 'worker';
    const [{ setup }, environmentModule] = await Promise.all([
      loadEnvironment(),
      loadTestEnvironmentModule(
        context.testEnvironmentModule,
        onTestEnvironmentFallback,
      ),
    ]);
    const { teardown } = await setup(
      runtimeGlobal as typeof globalThis,
      testEnvironment.options || {},
      { scope },
      environmentModule,
    );
    if (scope === 'file') {
      cleanupFns.push(() => teardown(runtimeGlobal as typeof globalThis));
    }
  }
  // Pin only after setup succeeded. A setup failure (e.g. an invalid jsdom
  // option) surfaces as a file-level failure and leaves the worker reusable;
  // pinning eagerly would make every later same-key task skip setup and run
  // bare-Node against a config the user asked to be a DOM.
  if (!isVmPool && !isolate) {
    activeEnvironmentKey = environmentKey;
  }
  tracker?.transition('prepare');

  if (globals) {
    globalCleanups.push(installGlobalApis(api, runtimeGlobal));
  }

  const rstestContext = {
    global: runtimeGlobal,
    console: runtimeGlobal.console,
    Error: vmContext
      ? (runInContext('Error', vmContext) as typeof Error)
      : Error,
  };

  Object.assign(rstestContext.global, {
    [RSTEST_API_GLOBAL_KEY]: api,
    [RSTEST_IMPORT_META_GLOBAL_KEY]: resolveImportMetaRstest,
  });

  return {
    interopDefault,
    rstestContext,
    runner,
    rpc,
    silentConsoleController,
    api,
    taskContext,
    vmContext,
    unhandledErrors,
    cleanup: async () => {
      await Promise.all(cleanupFns.map((fn) => fn()));
      if (vmContext && initialVmContextKeys) {
        const { flushAllLoaderCaches } = await import('./interop');
        await flushAllLoaderCaches();
        stripVmContext(vmContext, initialVmContextKeys);
      }
    },
  };
};

const loadFiles = async ({
  setupEntries,
  assetFiles,
  rstestContext,
  distPath,
  runtimeDistPath,
  testPath,
  interopDefault,
  isolate,
  outputModule,
  federation,
  vmContext,
  runtimeGlobal,
  tracker,
}: {
  setupEntries: RunWorkerOptions['options']['setupEntries'];
  assetFiles: AssetFiles;
  rstestContext: Record<string, any>;
  distPath: string;
  runtimeDistPath?: string;
  testPath: string;
  interopDefault: boolean;
  isolate: boolean;
  outputModule: boolean;
  federation: boolean;
  vmContext?: Context;
  runtimeGlobal: Record<string, unknown>;
  tracker?: PhaseTracker;
}): Promise<void> => {
  const { loadModule } = outputModule
    ? await import('./loadEsModule')
    : await import('./loadModule');
  const virtualFsAssetFiles = federation ? assetFiles : undefined;

  // A reused worker can hold several projects' runtime chunks at once, so pass
  // the current entry path to every self-scoped cleaner. Only its
  // owning chunk can map that path to a cached module id.
  if (!isolate && !vmContext) {
    await loadModule({
      codeContent: `if (global && global.__rstest_cache_cleaners__) {
  global.__rstest_cache_cleaners__.forEach((fn) => fn(${JSON.stringify(normalize(testPath))}));
  }`,
      distPath: '',
      testPath,
      rstestContext,
      assetFiles,
      interopDefault,
      virtualFsAssetFiles,
    });
  }

  // run setup files
  tracker?.transition('setupFiles');
  for (const {
    distPath: setupDistPath,
    testPath: setupTestPath,
  } of setupEntries) {
    setFederationDynamicImportOrigin(federation, setupTestPath, runtimeGlobal);

    await loadModule({
      codeContent: getAssetText(assetFiles, setupDistPath),
      distPath: setupDistPath,
      runtimeDistPath,
      testPath: setupTestPath,
      rstestContext,
      assetFiles,
      interopDefault,
      virtualFsAssetFiles,
      vmContext,
      cacheCompilation: true,
    });
  }

  tracker?.transition('collect');
  setFederationDynamicImportOrigin(federation, testPath, runtimeGlobal);
  await loadModule({
    codeContent: getAssetText(assetFiles, distPath),
    distPath,
    runtimeDistPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
    virtualFsAssetFiles,
    vmContext,
  });
};

export const runInPool = async (
  options: RunWorkerOptions['options'],
  lifecycleHooks: FileCleanupHooks & {
    onWorkerCleanupStart?: () => MaybePromise<void>;
    onWorkerCleanupEnd?: (error?: unknown) => MaybePromise<void>;
    onTestEnvironmentFallback?: (
      fallback: TestEnvironmentModuleFallback,
    ) => void;
  } = {},
): Promise<
  | {
      tests: TestInfo[];
      testPath: string;
    }
  | TestFileResult
> => {
  isTeardown = false;
  const {
    entryInfo: { distPath, runtimeDistPath, testPath },
    setupEntries,
    assets,
    type,
    context: {
      project,
      buildId,
      runtimeConfig: { isolate, bail, detectAsyncLeaks, federation },
    },
  } = options;

  const cleanupWorkerFixtureScope = async (): Promise<unknown> => {
    await lifecycleHooks.onWorkerCleanupStart?.();
    let cleanupError: unknown;
    try {
      await cleanupWorkerFixtures();
    } catch (error) {
      cleanupError = error;
    } finally {
      await lifecycleHooks.onWorkerCleanupEnd?.(cleanupError);
    }
    return cleanupError;
  };

  const importLoader = () =>
    options.context.outputModule
      ? import('./loadEsModule')
      : import('./loadModule');

  // Keeping the runtime chunk is correct within one compile, but a watch rebuild
  // (bumped `buildId`) would serve a changed shared module from the previous
  // build's cache. Fully flush every loader on the rebuild boundary before
  // loading (see `flushAllLoaderCaches` for why both loaders, not just this
  // task's).
  const isVmPool = options.context.pool === 'vmThreads';
  const buildChanged = lastBuildId !== undefined && lastBuildId !== buildId;
  if (buildChanged) {
    const [esmLoader, cjsLoader] = await Promise.all([
      import('./loadEsModule'),
      import('./loadModule'),
    ]);
    esmLoader.clearCompilationCache();
    cjsLoader.clearCompilationCache();
  }
  if (!isVmPool && !isolate && buildChanged) {
    // A rebuild replaces fixture definitions too. Retire instances created by
    // the previous module graph before loading the new graph, otherwise both
    // generations can hold external resources in one reused worker.
    const cleanupError = await cleanupWorkerFixtureScope();
    if (cleanupError) {
      throw cleanupError;
    }
    const { flushAllLoaderCaches } = await import('./interop');
    await flushAllLoaderCaches();
  }
  lastBuildId = buildId;

  const cleanups: (() => MaybePromise<void>)[] = [];

  const exit = process.exit.bind(process);
  process.exit = (code = process.exitCode || 0): never => {
    throw new Error(`process.exit unexpectedly called with "${code}"`);
  };

  const kill = process.kill.bind(process);
  process.kill = (pid: number, signal?: NodeJS.Signals) => {
    if (pid === -1 || Math.abs(pid) === process.pid) {
      throw new Error(
        `process.kill unexpectedly called with "${pid}" and "${signal}"`,
      );
    }
    return kill(pid, signal);
  };

  cleanups.push(() => {
    process.kill = kill;
    process.exit = exit;
  });

  const teardown = async () => {
    await new Promise((resolve) => getRealTimers().setTimeout!(resolve));

    // Run teardown
    await Promise.all(cleanups.map((fn) => fn()));

    if (isVmPool) {
      const { flushAllLoaderCaches } = await import('./interop');
      await flushAllLoaderCaches();
    } else if (!isolate) {
      const { clearModuleCache } = await importLoader();
      // Keep the shared runtime chunk so imported module state survives across
      // files. Its cache-control runtime invalidates setup and the next current
      // entry immediately before that file loads.
      clearModuleCache(runtimeDistPath);
    }

    isTeardown = true;
  };

  // Initialize coverage collector if coverage is enabled
  let coverageProvider: Awaited<
    ReturnType<typeof import('../../coverage').createCoverageProvider>
  > | null = null;

  if (type === 'collect') {
    try {
      const {
        rstestContext,
        runner,
        rpc,
        cleanup,
        unhandledErrors,
        interopDefault,
        vmContext,
      } = await preparePool(
        options,
        undefined,
        lifecycleHooks.onTestEnvironmentFallback,
      );
      const { assetFiles, sourceMaps: sourceMapsFromAssets } =
        assets || (await rpc.getAssetsByEntry());
      sourceMaps = sourceMapsFromAssets;

      cleanups.push(cleanup);

      await loadFiles({
        rstestContext,
        distPath,
        runtimeDistPath,
        testPath,
        assetFiles,
        setupEntries,
        interopDefault,
        isolate,
        outputModule: options.context.outputModule,
        federation: federation === true,
        vmContext,
        runtimeGlobal: rstestContext.global,
      });
      const tests = await runner.collectTests();
      return {
        project,
        testPath,
        tests,
        errors: await formatTestError(unhandledErrors),
      };
    } catch (err) {
      return {
        project,
        testPath,
        tests: [],
        errors: await formatTestError(err),
      };
    } finally {
      await teardown();
    }
  }

  let taskContext: TaskContext | undefined;
  const tracker = new PhaseTracker(
    options.context.trace
      ? {
          trace: {
            testPath,
            project: options.context.project,
          },
          pid: tracePid,
        }
      : undefined,
  );
  let runResult: TestFileResult | undefined;
  let asyncLeakDetector: ReturnType<typeof createAsyncLeakDetector> | undefined;

  try {
    tracker.transition('prepare');
    const {
      rstestContext,
      runner,
      rpc,
      silentConsoleController,
      api,
      cleanup,
      unhandledErrors,
      interopDefault,
      vmContext,
      taskContext: preparedTaskContext,
    } = await preparePool(
      options,
      tracker,
      lifecycleHooks.onTestEnvironmentFallback,
    );
    taskContext = preparedTaskContext;
    if (detectAsyncLeaks) {
      asyncLeakDetector = createAsyncLeakDetector(taskContext);
      asyncLeakDetector.enable();
    }

    if (bail && (await rpc.getCountOfFailedTests()) >= bail) {
      runResult = {
        testId: getFileTaskId(testPath),
        project,
        testPath,
        status: 'skip',
        name: '',
        results: [],
      };
      return runResult;
    }

    if (options.context.runtimeConfig.coverage?.enabled) {
      const { createCoverageProvider } = await import('../../coverage');
      coverageProvider = await createCoverageProvider(
        options.context.runtimeConfig.coverage,
        options.context.projectRoot,
      );
    }
    if (coverageProvider) {
      await coverageProvider.init();
    }

    tracker.transition('load');
    const { assetFiles, sourceMaps: sourceMapsFromAssets } =
      assets || (await rpc.getAssetsByEntry());
    sourceMaps = sourceMapsFromAssets;

    cleanups.push(cleanup);

    rpc.onTestFileStart?.({
      testId: getFileTaskId(testPath),
      testPath,
      project,
      tests: [],
    });

    // Keep file-level context only while evaluating top-level module code.
    // Once the runner starts, suite/case tasks should own subsequent logs so
    // passed suite buffers are not replayed by the final file-level flush.
    taskContext.setFallback({
      taskId: getFileTaskId(testPath),
      taskType: 'file',
      testPath,
    });

    try {
      await loadFiles({
        rstestContext,
        distPath,
        runtimeDistPath,
        testPath,
        assetFiles,
        setupEntries,
        interopDefault,
        isolate,
        outputModule: options.context.outputModule,
        federation: federation === true,
        vmContext,
        runtimeGlobal: rstestContext.global,
        tracker,
      });
    } finally {
      taskContext.setFallback(undefined);
    }

    tracker.transition('tests');
    const collectCoverage = async (result: TestFileResult): Promise<void> => {
      if (!coverageProvider) {
        return;
      }
      const provider = coverageProvider;
      tracker.transition('coverage');
      const collectOptions = {
        assetFiles: Object.fromEntries(
          Object.keys(assetFiles)
            .filter((name) => /\.[cm]?js$/.test(name))
            .map((name) => [name, getAssetText(assetFiles, name)]),
        ),
        sourceMaps,
        outputModule: options.context.outputModule,
      };

      const collect = async () => {
        const coverageMap = await provider.collect(collectOptions);
        if (coverageMap) {
          result.coverage = {};
          Object.entries(coverageMap.toJSON()).forEach(([key, value]) => {
            if ('toJSON' in value)
              result.coverage![key] = value.toJSON() as FileCoverageData;
            else result.coverage![key] = value;
          });
        }
      };

      if (provider.collectRaw && provider.resolveRawCoverage) {
        const rawCoverage = await provider.collectRaw(collectOptions);
        if (rawCoverage != null) {
          result.coverageRaw = rawCoverage;
        } else {
          await collect();
        }
      } else {
        await collect();
      }
      tracker.transition('tests');
    };

    let fileCleanupResult: TestFileResult | undefined;
    const runnerHooks: RunnerHooks & FileCleanupHooks = {
      onTestFileReady: async (test) => {
        await rpc.onTestFileReady(test);
      },
      onTestSuiteStart: async (test) => {
        tracker.recordSuiteStart(test);
        await rpc.onTestSuiteStart(test);
      },
      onTestSuiteResult: async (result) => {
        tracker.recordSuiteResult(result);
        silentConsoleController.flushBufferedLogsForTask({
          taskId: result.testId,
          status: result.status,
          taskParentNames: result.parentNames,
          taskType: 'suite',
          testPath: result.testPath,
        });
        await rpc.onTestSuiteResult(result);
      },
      onTestCaseStart: async (test) => {
        tracker.recordCaseStart(test);
        await rpc.onTestCaseStart(test);
      },
      onTestCaseResult: async (result) => {
        tracker.recordCaseResult(result);
        silentConsoleController.flushBufferedLogsForTask({
          taskId: result.testId,
          status: result.status,
          taskParentNames: result.parentNames,
          taskType: 'case',
          testPath: result.testPath,
        });
        await rpc.onTestCaseResult(result);
      },
      onFileCleanupStart: async (result) => {
        fileCleanupResult = result;
        await lifecycleHooks.onFileCleanupStart?.(result);
      },
      onFileCleanupEnd: async () => {
        await lifecycleHooks.onFileCleanupEnd?.();
        if (fileCleanupResult) {
          await collectCoverage(fileCleanupResult);
        }
      },
      getCountOfFailedTests: async () => {
        return rpc.getCountOfFailedTests();
      },
    };
    const results = await runner.runTests(testPath, runnerHooks, api);

    if (asyncLeakDetector) {
      // Undo any time mocking before collecting leaks and before a reused worker
      // runs the next file. This must cover BOTH full fake timers and a
      // date-only `setSystemTime()` pin (which leaves `isFakeTimers()` false);
      // `useRealTimers()` is an idempotent no-op when nothing is mocked.
      api.rstest.useRealTimers();
      const asyncLeakErrors = await asyncLeakDetector.collectErrors();
      if (asyncLeakErrors.length > 0) {
        results.status = 'fail';
        results.errors = (results.errors || []).concat(asyncLeakErrors);
      }
    }

    if (unhandledErrors.length > 0) {
      results.status = 'fail';
      results.errors = (results.errors || []).concat(
        ...(await formatTestError(unhandledErrors)),
      );
    }

    silentConsoleController.flushBufferedLogsForTask({
      taskId: results.testId,
      status: results.status,
      taskParentNames: results.parentNames,
      taskType: 'file',
      testPath: results.testPath,
    });

    runResult = results;
    return runResult;
  } catch (err) {
    runResult = {
      testId: getFileTaskId(testPath),
      project,
      testPath,
      status: 'fail',
      name: '',
      results: [],
      errors: await formatTestError(err),
    };
    return runResult;
  } finally {
    tracker.transition('teardown');
    taskContext?.setFallback(undefined);
    asyncLeakDetector?.disable();
    if (isolate || isVmPool) {
      const workerCleanupError = await cleanupWorkerFixtureScope();
      if (workerCleanupError && runResult) {
        runResult.status = 'fail';
        runResult.errors = [
          ...(runResult.errors ?? []),
          ...(await formatTestError(workerCleanupError)),
        ];
      }
    }
    if (coverageProvider) {
      coverageProvider.cleanup();
    }
    await teardown();
    tracker.end();
    if (runResult) {
      const traceEvents = tracker.getTraceEvents();
      if (traceEvents) {
        runResult.traceEvents = traceEvents;
      }
    }
  }
};
