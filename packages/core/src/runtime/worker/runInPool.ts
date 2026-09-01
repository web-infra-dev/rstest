import type { FileCoverageData } from 'istanbul-lib-coverage';
import { setFlagsFromString } from 'node:v8';
import { createContext, runInContext, Script, type Context } from 'node:vm';
import { isMainThread, threadId } from 'node:worker_threads';
import { normalize } from 'pathe';
import { install } from 'source-map-support';
import type {
  AssetFiles,
  MaybePromise,
  RunnerHooks,
  RuntimeRPC,
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
import { clearFileContext } from '../fileContext';
import type { FileCleanupHooks } from '../runner';
import { cleanupWorkerFixtures } from '../runner/fixtures';
import { createAsyncLeakDetector } from './asyncLeaks';
import { environmentLoaders } from './env/registry';
import { loadTestEnvironmentModule } from './env/testEnvironmentModule';
import { installGlobalApis, installGlobalProperty } from './globalProperty';
import { PhaseTracker } from './phaseTracker';
import { loadCachedAssets, workerAssetCache } from './vm/assetCache';
import { createRuntimeRpc, createWorkerRpcOptions } from './rpc';
import { setFederationDynamicImportOrigin } from './runtimeHooks';
import { createSilentConsoleController } from './silentConsole';
import { RstestSnapshotEnvironment } from './snapshot';
import { createNodeTaskContext } from './taskContext.node';
import type { TaskContext } from './taskContext';
import {
  clearVmExternalCompilationCache,
  disposeVmExternalModules,
} from './vm/externalModules';
import { workerCache } from './vm/cache';

let sourceMaps: Record<string, string> = {};
let vmCompilationCacheDisabled = false;

const disableVmCompilationCache = (): void => {
  if (vmCompilationCacheDisabled) {
    return;
  }
  // V8's isolate-wide compilation cache is unbounded and retains scripts from
  // every disposed Context. vmThreads uses the bounded worker cache instead.
  setFlagsFromString('--no-compilation-cache');
  vmCompilationCacheDisabled = true;
};

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
 * Restores task-scoped global mutations at the next task boundary for regular
 * `isolate: false` pools, so late callbacks keep the console and RPC they
 * captured. VM pools drain the same list during file teardown so the completed
 * realm is not retained when worker memory is sampled.
 */
const globalCleanups: (() => void)[] = [];

const runGlobalCleanups = (): void => {
  const cleanups = globalCleanups.splice(0);
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Failed to restore worker globals.');
  }
};

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
const loadTaskAssets = async (
  options: RunWorkerOptions['options'],
  assets: RunWorkerOptions['options']['assets'],
  rpc: Pick<RuntimeRPC, 'getAssetsByEntry'>,
): Promise<NonNullable<RunWorkerOptions['options']['assets']>> => {
  const { assetNames, context } = options;
  if (context.pool === 'vmThreads') {
    workerCache.configure(context.workerCacheLimit ?? 0);
  }
  if (assets) {
    return assets;
  }

  if (context.pool !== 'vmThreads' || context.workerCacheLimit === undefined) {
    return rpc.getAssetsByEntry(assetNames);
  }

  return loadCachedAssets(assetNames, workerAssetCache, rpc.getAssetsByEntry);
};

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

type VmRuntimeGlobal = typeof globalThis & Record<string, unknown>;

const createVmFunction = <T>(
  vmContext: Context,
  source: string,
  hostFunction: T,
): T => {
  const createFunction = runInContext(source, vmContext) as (value: T) => T;
  return createFunction(hostFunction);
};

const installVmNodeGlobals = (
  runtimeGlobal: VmRuntimeGlobal,
  vmContext: Context,
): void => {
  const excluded = new Set([
    'GLOBAL',
    'root',
    'global',
    'globalThis',
    'fetch',
    'structuredClone',
  ]);
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    if (excluded.has(key) || key in runtimeGlobal) {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) {
      Object.defineProperty(runtimeGlobal, key, descriptor);
    }
  }

  if (!('fetch' in runtimeGlobal) && typeof globalThis.fetch === 'function') {
    Reflect.set(
      runtimeGlobal,
      'fetch',
      createVmFunction(
        vmContext,
        '(hostFetch) => async (...args) => hostFetch(...args)',
        globalThis.fetch,
      ),
    );
  }
  if (
    !('structuredClone' in runtimeGlobal) &&
    typeof globalThis.structuredClone === 'function'
  ) {
    Reflect.set(
      runtimeGlobal,
      'structuredClone',
      createVmFunction(
        vmContext,
        `(hostStructuredClone) => {
        const restoreValue = (value, seen) => {
          if (value === null || typeof value !== 'object' || seen.has(value)) {
            return value;
          }
          seen.add(value);

          const tag = Object.prototype.toString.call(value);
          if (tag === '[object Array]') {
            Object.setPrototypeOf(value, Array.prototype);
          } else if (tag === '[object Map]') {
            Object.setPrototypeOf(value, Map.prototype);
            for (const [key, entry] of value) {
              restoreValue(key, seen);
              restoreValue(entry, seen);
            }
          } else if (tag === '[object Set]') {
            Object.setPrototypeOf(value, Set.prototype);
            for (const entry of value) {
              restoreValue(entry, seen);
            }
          } else if (tag === '[object Date]') {
            Object.setPrototypeOf(value, Date.prototype);
          } else if (tag === '[object RegExp]') {
            Object.setPrototypeOf(value, RegExp.prototype);
          } else if (tag === '[object Error]') {
            const constructor = globalThis[value.name];
            Object.setPrototypeOf(
              value,
              typeof constructor === 'function' &&
                (constructor === Error || constructor.prototype instanceof Error)
                ? constructor.prototype
                : Error.prototype,
            );
          } else if (tag === '[object ArrayBuffer]') {
            Object.setPrototypeOf(value, ArrayBuffer.prototype);
          } else if (tag === '[object DataView]') {
            Object.setPrototypeOf(value, DataView.prototype);
          } else {
            const constructorName = tag.slice(8, -1);
            const constructor = globalThis[constructorName];
            if (typeof constructor === 'function' && constructor.prototype) {
              Object.setPrototypeOf(value, constructor.prototype);
            } else {
              Object.setPrototypeOf(
                value,
                Object.getPrototypeOf(value) === null
                  ? null
                  : Object.prototype,
              );
            }
          }

          for (const key of Object.keys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (descriptor && 'value' in descriptor) {
              restoreValue(descriptor.value, seen);
            }
          }
          return value;
        };

        return (value, options) =>
          restoreValue(hostStructuredClone(value, options), new WeakSet());
        }`,
        globalThis.structuredClone,
      ),
    );
  }

  Object.assign(runtimeGlobal, {
    process,
    Buffer,
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

const prepareVmRuntimeRealm = async (
  context: RunWorkerOptions['options']['context'],
  cleanupFns: (() => MaybePromise<void>)[],
  onTestEnvironmentFallback?: (fallback: TestEnvironmentModuleFallback) => void,
): Promise<{
  initialKeys: Set<string | symbol>;
  runtimeGlobal: VmRuntimeGlobal;
  vmContext: Context;
  setVirtualConsoleTarget?: (target: Console) => void;
}> => {
  const { testEnvironment } = context.runtimeConfig;
  let vmContext: Context;
  let setVirtualConsoleTarget: ((target: Console) => void) | undefined;
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
    setVirtualConsoleTarget = vmEnvironment.setVirtualConsoleTarget;
  }

  const runtimeGlobal = runInContext(
    'globalThis',
    vmContext,
  ) as VmRuntimeGlobal;
  installVmNodeGlobals(runtimeGlobal, vmContext);
  return {
    initialKeys: captureVmContextKeys(vmContext),
    runtimeGlobal,
    setVirtualConsoleTarget,
    vmContext,
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
  runGlobalCleanups();

  const taskContext = createNodeTaskContext();
  const writeOriginalLog = createOriginalLogWriter();
  setRealTimers();

  const cleanupFns: (() => MaybePromise<void>)[] = [];
  const isVmPool = context.pool === 'vmThreads';
  let vmContext: Context | undefined;
  let initialVmContextKeys: Set<string | symbol> | undefined;
  let runtimeGlobal = globalThis as VmRuntimeGlobal;
  let setVirtualConsoleTarget: ((target: Console) => void) | undefined;

  const disposeFns: (() => void)[] = [];
  const { rpc } = createRuntimeRpc(
    createWorkerRpcOptions({ dispose: disposeFns }),
  );

  let preparedPoolCleaned = false;
  const cleanupPreparedPool = async (forceGlobalCleanup = false) => {
    if (preparedPoolCleaned) {
      return;
    }
    preparedPoolCleaned = true;

    const errors: unknown[] = [];
    const cleanupResults = await Promise.allSettled(
      cleanupFns.map((fn) => fn()),
    );
    for (const result of cleanupResults) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }

    if (isVmPool || forceGlobalCleanup) {
      try {
        runGlobalCleanups();
      } catch (error) {
        errors.push(error);
      }
    }
    if (vmContext && initialVmContextKeys) {
      try {
        const { flushAllLoaderCaches } = await import('./interop');
        await flushAllLoaderCaches();
      } catch (error) {
        errors.push(error);
      }
      disposeVmExternalModules(vmContext);
      try {
        stripVmContext(vmContext, initialVmContextKeys);
      } catch (error) {
        errors.push(error);
      }
    }
    if (isVmPool) {
      clearFileContext();
      sourceMaps = {};
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to clean up the test runtime.');
    }
  };

  try {
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
      const vmRealm = await prepareVmRuntimeRealm(
        context,
        cleanupFns,
        onTestEnvironmentFallback,
      );
      vmContext = vmRealm.vmContext;
      runtimeGlobal = vmRealm.runtimeGlobal;
      initialVmContextKeys = vmRealm.initialKeys;
      setVirtualConsoleTarget = vmRealm.setVirtualConsoleTarget;
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
    } else if (isVmPool) {
      // `vm.createContext` installs a console that intentionally discards
      // output. With interception disabled, expose the worker console so
      // direct `console.log` calls retain Node's normal stdout/stderr behavior.
      globalCleanups.push(
        installGlobalProperty(runtimeGlobal, 'console', globalThis.console),
      );
    }

    if (isVmPool && runtimeGlobal.console) {
      setVirtualConsoleTarget?.(runtimeGlobal.console);
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
    const unhandledRejection = (e: Error) =>
      handleError(e, 'unhandledRejection');

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
        runtimeGlobal,
      },
    );

    tracker?.transition('envSetup');
    const hasPinnedEnvironment =
      !isVmPool && activeEnvironmentKey !== undefined;
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
      cleanup: cleanupPreparedPool,
    };
  } catch (error) {
    try {
      await cleanupPreparedPool(true);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Failed to prepare and clean up the test runtime.',
      );
    }
    throw error;
  }
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
      vmContext,
      cacheCompilation: vmContext !== undefined,
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
  if (isVmPool) {
    disableVmCompilationCache();
  }
  const buildChanged = lastBuildId !== undefined && lastBuildId !== buildId;
  if (buildChanged) {
    workerCache.clear();
    const [esmLoader, cjsLoader] = await Promise.all([
      import('./loadEsModule'),
      import('./loadModule'),
    ]);
    esmLoader.clearCompilationCache();
    cjsLoader.clearCompilationCache();
    clearVmExternalCompilationCache();
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
  const pendingRunnerHooks = new Set<Promise<void>>();

  const trackRunnerHook = (call: Promise<void>): Promise<void> => {
    if (!isVmPool) {
      return call;
    }
    pendingRunnerHooks.add(call);
    void call.then(
      () => pendingRunnerHooks.delete(call),
      () => {
        // Keep rejected calls in the set so teardown can report them.
      },
    );
    return call;
  };

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

    const errors: unknown[] = [];
    if (isVmPool) {
      const runnerHookResults = await Promise.allSettled(pendingRunnerHooks);
      pendingRunnerHooks.clear();
      for (const result of runnerHookResults) {
        if (result.status === 'rejected') {
          errors.push(result.reason);
        }
      }
    }
    const cleanupResults = await Promise.allSettled(cleanups.map((fn) => fn()));
    for (const result of cleanupResults) {
      if (result.status === 'rejected') {
        errors.push(result.reason);
      }
    }

    try {
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
    } catch (error) {
      errors.push(error);
    } finally {
      isTeardown = true;
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to tear down the test runtime.');
    }
  };

  // Initialize coverage collector if coverage is enabled
  let coverageProvider: Awaited<
    ReturnType<typeof import('../../coverage').createCoverageProvider>
  > | null = null;

  if (type === 'collect') {
    let collectResult:
      | {
          project: string;
          testPath: string;
          tests: TestInfo[];
          errors: Awaited<ReturnType<typeof formatTestError>>;
        }
      | undefined;
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
      cleanups.push(cleanup);
      const { assetFiles, sourceMaps: sourceMapsFromAssets } =
        await loadTaskAssets(options, assets, rpc);
      sourceMaps = sourceMapsFromAssets;

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
      collectResult = {
        project,
        testPath,
        tests,
        errors: await formatTestError(unhandledErrors),
      };
    } catch (err) {
      collectResult = {
        project,
        testPath,
        tests: [],
        errors: await formatTestError(err),
      };
    } finally {
      try {
        if (isolate || isVmPool) {
          const workerCleanupError = await cleanupWorkerFixtureScope();
          if (workerCleanupError && collectResult) {
            collectResult.errors = [
              ...collectResult.errors,
              ...(await formatTestError(workerCleanupError)),
            ];
          }
        }
      } finally {
        await teardown();
      }
    }
    return collectResult!;
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
  let runResult: TestFileResult = {
    testId: getFileTaskId(testPath),
    project,
    testPath,
    status: 'fail',
    name: '',
    results: [],
    errors: [],
  };
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
    cleanups.push(cleanup);
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
      await coverageProvider.init({
        // Coverage providers execute in the worker realm, while instrumented
        // code executes in this file's VM realm.
        global: rstestContext.global as typeof globalThis,
      });
    }

    tracker.transition('load');
    const { assetFiles, sourceMaps: sourceMapsFromAssets } =
      await loadTaskAssets(options, assets, rpc);
    sourceMaps = sourceMapsFromAssets;

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
      onTestFileReady: (test) => trackRunnerHook(rpc.onTestFileReady(test)),
      onTestSuiteStart: (test) =>
        trackRunnerHook(
          (async () => {
            tracker.recordSuiteStart(test);
            await rpc.onTestSuiteStart(test);
          })(),
        ),
      onTestSuiteResult: (result) =>
        trackRunnerHook(
          (async () => {
            tracker.recordSuiteResult(result);
            silentConsoleController.flushBufferedLogsForTask({
              taskId: result.testId,
              status: result.status,
              taskParentNames: result.parentNames,
              taskType: 'suite',
              testPath: result.testPath,
            });
            await rpc.onTestSuiteResult(result);
          })(),
        ),
      onTestCaseStart: (test) =>
        trackRunnerHook(
          (async () => {
            tracker.recordCaseStart(test);
            await rpc.onTestCaseStart(test);
          })(),
        ),
      onTestCaseResult: (result) =>
        trackRunnerHook(
          (async () => {
            tracker.recordCaseResult(result);
            silentConsoleController.flushBufferedLogsForTask({
              taskId: result.testId,
              status: result.status,
              taskParentNames: result.parentNames,
              taskType: 'case',
              testPath: result.testPath,
            });
            await rpc.onTestCaseResult(result);
          })(),
        ),
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
    const teardownErrors: unknown[] = [];
    try {
      if (isolate || isVmPool) {
        const workerCleanupError = await cleanupWorkerFixtureScope();
        if (workerCleanupError) {
          runResult.status = 'fail';
          runResult.errors = [
            ...(runResult.errors ?? []),
            ...(await formatTestError(workerCleanupError)),
          ];
        }
      }
    } catch (error) {
      teardownErrors.push(error);
    }
    try {
      coverageProvider?.cleanup();
    } catch (error) {
      teardownErrors.push(error);
    }
    try {
      await teardown();
    } catch (error) {
      teardownErrors.push(error);
    }
    tracker.end();
    if (teardownErrors.length > 0) {
      runResult.status = 'fail';
      runResult.errors = [
        ...(runResult.errors ?? []),
        ...(await formatTestError(teardownErrors)),
      ];
    }
    const traceEvents = tracker.getTraceEvents();
    if (traceEvents) {
      runResult.traceEvents = traceEvents;
    }
  }
};
