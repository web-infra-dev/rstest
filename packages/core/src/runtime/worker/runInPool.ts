import type { FileCoverageData } from 'istanbul-lib-coverage';
import { isMainThread, threadId } from 'node:worker_threads';
import { install } from 'source-map-support';
import type {
  MaybePromise,
  Rstest,
  RunWorkerOptions,
  TestFileResult,
  TestInfo,
  WorkerState,
} from '../../types';
import { globalApis } from '../../utils/constants';
import { color } from '../../utils/logger';
import { formatTestError, getRealTimers, setRealTimers } from '../util';
import { createAsyncLeakDetector } from './asyncLeaks';
import { PhaseTracker } from './phaseTracker';
import { createRuntimeRpc, createWorkerRpcOptions } from './rpc';
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

const registerGlobalApi = (api: Rstest) => {
  return globalApis.reduce<{
    [key in keyof Rstest]?: Rstest[key];
  }>((apis, key) => {
    // @ts-expect-error register to global
    globalThis[key] = api[key] as any;
    return apis;
  }, {});
};

const globalCleanups: (() => void)[] = [];
let isTeardown = false;

/**
 * Worker-scope test-environment cache. In `isolate: 'soft' | false` the
 * worker is reused across files, so paying the jsdom/happyDom setup cost
 * per file is wasteful — and tearing the env down between files races with
 * any async work the previous file scheduled (e.g. React commit phase
 * accessing `window` after `dom.window.close()` already ran).
 *
 * The cached entry is reset between files via `softResetEnv` (clear DOM,
 * reset URL) so leaked DOM state from file N doesn't contaminate file N+1.
 *
 * `protoSnapshot` captures the original property descriptors of well-known
 * DOM prototypes so we can revert in-place mutations vendor packages make
 * during a file run (e.g. `@testing-library/user-event`'s `patchFocus`
 * which replaces `HTMLElement.prototype.focus` with a getter-only
 * descriptor; the next file's bundle re-evaluation does
 * `prototype.focus = newFn` and dies on "has only a getter").
 */
let cachedEnv:
  | {
      name: string;
      teardown: (global: any) => MaybePromise<void>;
      protoSnapshot: ProtoEntry[];
    }
  | undefined;

// In soft mode the per-file `cleanupFns` does NOT include the env teardown
// (the env persists across files). Without this hook, a worker that exits
// cleanly (no fatal error, pool drained) leaks the JSDOM window — virtual
// console handlers, scheduled timers, the cookie jar, the global Proxy.
// On `beforeExit` we still have a chance to flush; on `exit` (synchronous)
// we just attempt the call and ignore.
//
// `process.exit` short-circuits `beforeExit`, but rstest's pool sends
// graceful shutdown messages and the worker returns from the message loop,
// so beforeExit fires in the common case.
const teardownCachedEnvOnExit = (): void => {
  if (!cachedEnv) return;
  try {
    // Fire-and-forget; the event loop is already winding down so awaiting
    // a promise here is best-effort. JSDOM's teardown is synchronous as of
    // jsdom 26.x — this stays meaningful even without await.
    void cachedEnv.teardown(global);
  } catch {
    // best-effort
  } finally {
    cachedEnv = undefined;
  }
};
process.on('beforeExit', teardownCachedEnvOnExit);
process.on('exit', teardownCachedEnvOnExit);

/**
 * Snapshot every own-property descriptor on the well-known DOM prototypes
 * the worker exposes via globals. This is the "all-keys" form: we capture
 * each descriptor at env-setup time and re-apply it between files when its
 * shape has drifted (e.g. `@testing-library/user-event`'s `patchFocus`
 * replaces `HTMLElement.prototype.focus` with a getter-only descriptor on
 * the first `userEvent.click()`; without restore, file N+1's vendor code
 * that re-assigns via `prototype.focus = fn` throws "has only a getter").
 *
 * Why "all keys" and not a curated allow-list: vendor monkey-patching
 * targets are open-ended (focus, blur, addEventListener, dispatchEvent,
 * scrollIntoView, getBoundingClientRect, animate, matches, closest, …).
 * A curated list misses one and you get confusing failures only on
 * specific libs. The cost is small — ~3 prototypes × ~50-100 own keys
 * each, descriptor lookups are O(1).
 *
 * `constructor` is excluded: rewriting it can break `instanceof` checks
 * in any code that has a stale constructor reference.
 */
type ProtoEntry = {
  proto: object;
  descriptors: Record<PropertyKey, PropertyDescriptor>;
};

const SKIP_PROTO_KEYS = new Set<PropertyKey>(['constructor']);

const captureProtoDescriptors = (
  proto: object,
): Record<PropertyKey, PropertyDescriptor> => {
  const descriptors: Record<PropertyKey, PropertyDescriptor> = {};
  const keys: PropertyKey[] = [
    ...Object.getOwnPropertyNames(proto),
    ...Object.getOwnPropertySymbols(proto),
  ];
  for (const key of keys) {
    if (SKIP_PROTO_KEYS.has(key)) continue;
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (d) descriptors[key as string] = d;
  }
  return descriptors;
};

const captureProtoSnapshot = (win: any): ProtoEntry[] => {
  const protos = [
    win.HTMLElement?.prototype,
    win.Element?.prototype,
    win.Node?.prototype,
  ].filter(Boolean) as object[];
  return protos.map((proto) => ({
    proto,
    descriptors: captureProtoDescriptors(proto),
  }));
};

const descriptorEquals = (
  a: PropertyDescriptor,
  b: PropertyDescriptor,
): boolean =>
  a.value === b.value &&
  a.get === b.get &&
  a.set === b.set &&
  a.writable === b.writable &&
  a.enumerable === b.enumerable &&
  a.configurable === b.configurable;

const restoreProtoSnapshot = (snapshot: ProtoEntry[]): void => {
  for (const { proto, descriptors } of snapshot) {
    const keys: PropertyKey[] = [
      ...Object.getOwnPropertyNames(descriptors),
      ...Object.getOwnPropertySymbols(descriptors),
    ];
    for (const key of keys) {
      const original = (descriptors as any)[key] as PropertyDescriptor;
      const current = Object.getOwnPropertyDescriptor(proto, key);
      if (current && descriptorEquals(current, original)) continue;
      try {
        Object.defineProperty(proto, key, original);
      } catch {
        // Property is non-configurable (some Web IDL bindings) and was
        // mutated in-place — we can't undo. Falls through; the caller
        // accepts that some leaks may persist.
      }
    }
  }
};

/**
 * Per-step reset wrapper. Each step is independent — if one throws the
 * others should still run. We log to stderr in `DEBUG=rstest:soft-mode`
 * so silent failures can surface without forcing every consumer to opt
 * into noisy logs.
 *
 * Returning `void` keeps the call sites readable; the caller doesn't
 * need to know which step failed, just that the env wound up as clean
 * as best-effort can make it.
 */
const softResetStep = (label: string, fn: () => void): void => {
  try {
    fn();
  } catch (e) {
    if (process.env.DEBUG?.includes('rstest:soft-mode')) {
      const msg = e instanceof Error ? e.message : String(e);
      process.stderr.write(
        `[rstest:soft-mode] reset step "${label}" failed: ${msg}\n`,
      );
    }
  }
};

/**
 * Drain pending microtasks and a few macrotask cycles, absorbing any
 * `unhandledRejection` / `uncaughtException` that fires during the drain.
 *
 * Why: under `experiments.softMode` (or `isolate: false`), a worker
 * survives across files. If the previous file's tests started an XHR
 * (e.g. via a `useEffect` that wasn't awaited in the test body), the
 * XHR is still in flight when the file ends. Once the previous file's
 * mock-server handlers have been reset and the file slot has closed, the
 * XHR resolves — its `onUnhandledRequest` error bubbles up as an
 * unhandled rejection and lands in the NEXT file's slot, wrongly
 * attributing the failure.
 *
 * In `isolate: true`, the worker process dies between files, so the
 * pending XHR dies with it. In Jest, the per-file `vm.Context` is torn
 * down — same effect. Worker-reuse modes don't get that for free, so
 * we recreate the moral equivalent: give pending async ~5 macrotask
 * cycles to finish and absorb any errors that surface during the drain.
 *
 * Errors absorbed here are NOT attributable to the next file in any
 * useful way — they originate in the previous file and only manifest
 * now. Surfacing them as the next file's failure is worse than dropping
 * them (the previous file already passed its assertions; if it had a
 * latent leak, that's a test-code hygiene issue users should address
 * separately). Set `DEBUG=rstest:soft-mode` to log the absorbed count.
 */
const drainPendingAsyncFromPriorFile = async (): Promise<void> => {
  const absorbed: unknown[] = [];
  const swallow = (e: unknown) => {
    absorbed.push(e);
  };
  process.on('unhandledRejection', swallow);
  process.on('uncaughtException', swallow);
  try {
    // Each iteration awaits one `setImmediate` cycle: that drains all
    // currently-queued microtasks (Promise jobs run before the next macro)
    // plus one macrotask batch. 5 cycles is enough to settle typical
    // fetch → response → React commit chains; more is wasted budget.
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((resolve) =>
        getRealTimers().setImmediate
          ? getRealTimers().setImmediate!(resolve)
          : getRealTimers().setTimeout!(resolve, 0),
      );
    }
  } finally {
    process.removeListener('unhandledRejection', swallow);
    process.removeListener('uncaughtException', swallow);
  }
  if (absorbed.length > 0 && process.env.DEBUG?.includes('rstest:soft-mode')) {
    process.stderr.write(
      `[rstest:soft-mode] absorbed ${absorbed.length} async error(s) from prior file\n`,
    );
  }
};

const softResetEnv = (envName: string, protoSnapshot?: ProtoEntry[]): void => {
  if (envName !== 'jsdom' && envName !== 'happy-dom') return;
  const g = global as unknown as {
    document?: {
      body?: { innerHTML: string };
      head?: { innerHTML: string };
      cookie?: string;
    };
    window?: {
      history?: { replaceState?: Function };
      scrollTo?: Function;
      localStorage?: { clear?: () => void };
      sessionStorage?: { clear?: () => void };
    };
  };

  softResetStep('body.innerHTML', () => {
    if (g.document?.body) g.document.body.innerHTML = '';
  });
  softResetStep('head.innerHTML', () => {
    if (g.document?.head) g.document.head.innerHTML = '';
  });
  softResetStep('history.replaceState', () => {
    g.window?.history?.replaceState?.(null, '', '/');
  });
  softResetStep('scrollTo', () => {
    g.window?.scrollTo?.(0, 0);
  });
  softResetStep('localStorage.clear', () => {
    g.window?.localStorage?.clear?.();
    // Also clear via globalThis in case test code references the global
    // shortcut rather than `window.localStorage` (some helpers do).
    (globalThis as any).localStorage?.clear?.();
  });
  softResetStep('sessionStorage.clear', () => {
    g.window?.sessionStorage?.clear?.();
    (globalThis as any).sessionStorage?.clear?.();
  });
  softResetStep('cookies', () => {
    // Setting `cookie` to an expired version of each existing pair drops
    // it. Note: cookies set with a non-root `path` won't be wiped by this
    // — tests that set such cookies need to clear them in afterEach.
    if (g.document && typeof g.document.cookie === 'string') {
      const cookies = g.document.cookie.split(';');
      for (const c of cookies) {
        const eqIx = c.indexOf('=');
        const name = (eqIx > -1 ? c.slice(0, eqIx) : c).trim();
        if (name) {
          g.document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
        }
      }
    }
  });
  if (protoSnapshot) {
    softResetStep('protoSnapshot.restore', () => {
      restoreProtoSnapshot(protoSnapshot);
    });
  }
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

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
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
  }: RunWorkerOptions['options'],
  tracker?: PhaseTracker,
) => {
  // Reset globalCleanups only when preparePool is called again (running without isolation)
  globalCleanups.forEach((fn) => {
    fn();
  });
  globalCleanups.length = 0;

  // If a cachedEnv exists, the worker is being reused for another file.
  // Drain any pending async work scheduled by the previous file BEFORE we
  // install this file's `unhandledRejection` listener — otherwise leftover
  // XHRs / promise chains from the previous file would resolve into this
  // file's slot and surface as misattributed errors. This is the moral
  // equivalent of the per-file vm.Context teardown Jest gets for free.
  if (cachedEnv && context.runtimeConfig.isolate !== true) {
    await drainPendingAsyncFromPriorFile();
  }

  const taskContext = createNodeTaskContext();
  setRealTimers();

  const cleanupFns: (() => MaybePromise<void>)[] = [];

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
    },
  } = context;

  setupEnv(env);

  const shouldInterceptConsole =
    !disableConsoleIntercept || silent === true || silent === 'passed-only';

  const silentConsoleController = createSilentConsoleController({
    runtimeConfig: {
      disableConsoleIntercept,
      silent,
    },
    emitInterceptedLog: async (log) => {
      try {
        await rpc.onConsoleLog(log);
      } catch {
        // RPC may already be closed if a pending async log (e.g. React
        // commit or microtask) fires after teardown. Drop it; the log is
        // best-effort and we don't want to spam unhandled rejections.
      }
    },
    writeOriginalLog: createOriginalLogWriter(),
  });

  if (shouldInterceptConsole) {
    const { createCustomConsole } = await import('./console');

    // Keep a minimal internal interception path when `silent` is enabled.
    // In `disableConsoleIntercept + silent` mode, logs are buffered in the
    // worker first and later replayed to the original worker streams according
    // to the silent policy, instead of being reported to the host.

    global.console = createCustomConsole({
      onConsoleLog: (log) => {
        silentConsoleController.onConsoleLog(log);
      },
      testPath,
      printConsoleTrace: !disableConsoleIntercept && printConsoleTrace,
      getCurrentTask: () => taskContext.getCurrent(),
    });
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

  const { api, runner } = await createRstestRuntime(workerState, {
    taskContext,
  });

  tracker?.transition('envSetup');
  const isolateMode = context.runtimeConfig.isolate;
  const canReuseEnv =
    isolateMode !== true &&
    cachedEnv !== undefined &&
    cachedEnv.name === testEnvironment.name;

  if (canReuseEnv) {
    // Worker is being reused for another file; soft-reset the env in place
    // (clear DOM + restore mutated DOM prototype descriptors) instead of
    // paying the full setup cost again. Pending-async drain already ran
    // at the top of preparePool (before per-file listeners installed).
    softResetEnv(cachedEnv!.name, cachedEnv!.protoSnapshot);
  } else {
    // Tear down any prior env of the wrong type before installing a fresh one.
    if (cachedEnv) {
      try {
        await cachedEnv.teardown(global);
      } catch {
        // ignore — installing the new env will overwrite globals anyway.
      }
      cachedEnv = undefined;
    }
    switch (testEnvironment.name) {
      case 'node':
        break;
      case 'jsdom': {
        const { environment } = await import('./env/jsdom');
        const { teardown } = await environment.setup(
          global,
          testEnvironment.options || {},
        );
        cachedEnv = {
          name: 'jsdom',
          teardown,
          protoSnapshot: captureProtoSnapshot(global as any),
        };
        break;
      }
      case 'happy-dom': {
        const { environment } = await import('./env/happyDom');
        const { teardown } = await environment.setup(
          global,
          testEnvironment.options || {},
        );
        cachedEnv = {
          name: 'happy-dom',
          teardown,
          protoSnapshot: captureProtoSnapshot(global as any),
        };
        break;
      }
      default:
        throw new Error(`Unknown test environment: ${testEnvironment.name}`);
    }
  }

  // In strict isolation, the env is torn down after the file via `cleanupFns`.
  // In soft mode, the cached env persists; teardown only fires when the
  // worker exits (handled by the pool, not this function).
  if (isolateMode === true && cachedEnv) {
    const env = cachedEnv;
    cleanupFns.push(async () => {
      await env.teardown(global);
      cachedEnv = undefined;
    });
  }

  tracker?.transition('prepare');

  if (globals) {
    registerGlobalApi(api);
  }

  const rstestContext = {
    global,
    console: global.console,
    Error,
  };

  // @ts-expect-error
  rstestContext.global['@rstest/core'] = api;

  return {
    interopDefault,
    rstestContext,
    runner,
    rpc,
    silentConsoleController,
    api,
    taskContext,
    unhandledErrors,
    cleanup: async () => {
      await Promise.all(cleanupFns.map((fn) => fn()));
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
  tracker,
}: {
  setupEntries: RunWorkerOptions['options']['setupEntries'];
  assetFiles: Record<string, string>;
  rstestContext: Record<string, any>;
  distPath: string;
  runtimeDistPath?: string;
  testPath: string;
  interopDefault: boolean;
  isolate: boolean | 'soft';
  outputModule: boolean;
  tracker?: PhaseTracker;
}): Promise<void> => {
  const { loadModule } = outputModule
    ? await import('./loadEsModule')
    : await import('./loadModule');

  // clean rstest core cache manually
  // Runs for any non-strict isolate (`false` or `'soft'`): the worker
  // process is reused across files, so rstest's internal state needs to
  // start clean for each new file.
  if (isolate !== true) {
    await loadModule({
      codeContent: `if (global && typeof global.__rstest_clean_core_cache__ === 'function') {
  global.__rstest_clean_core_cache__();
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
  for (const { distPath, testPath } of setupEntries) {
    const setupCodeContent = assetFiles[distPath]!;

    await loadModule({
      codeContent: setupCodeContent,
      distPath,
      runtimeDistPath,
      testPath,
      rstestContext,
      assetFiles,
      interopDefault,
    });
  }

  tracker?.transition('collect');
  await loadModule({
    codeContent: assetFiles[distPath]!,
    distPath,
    runtimeDistPath,
    testPath,
    rstestContext,
    assetFiles,
    interopDefault,
  });
};

export const runInPool = async (
  options: RunWorkerOptions['options'],
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
      runtimeConfig: { isolate, bail, detectAsyncLeaks },
    },
  } = options;

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

  // Captured by preparePool — used by teardown to perform per-file resets
  // when the worker is reused (`isolate !== true`).
  let perFileApi: Rstest | undefined;

  const teardown = async () => {
    await new Promise((resolve) => getRealTimers().setTimeout!(resolve));

    // Soft/non-strict isolate: process is reused for the next file, so we
    // must reset per-file global state that would otherwise leak.
    //
    // Per-api rstest.restoreAllMocks() only reaches spies registered to the
    // CURRENT file's `mocks` Set — spies from prior files are orphaned when
    // their api is GC'd, leaving the property descriptors patched. Use
    // tinyspy's worker-scope `restoreAll()` instead: it walks the same
    // module-level `spies` Set that `internalSpyOn` registers into, so it
    // restores every spy in the worker regardless of which api created it.
    //
    // The fake-timers reset is also critical: sinon's `install()` rejects a
    // second install on the same global, so the next file's
    // `useFakeTimers()` would throw "Can't install fake timers twice on the
    // same global object" without this.
    if (isolate !== true) {
      if (perFileApi) {
        try {
          if (perFileApi.rstest.isFakeTimers()) {
            perFileApi.rstest.useRealTimers();
          }
        } catch {
          // api may already be in a torn-down state; the next file's
          // preparePool will create a fresh one.
        }
      }
      try {
        const { restoreAll } = await import('tinyspy');
        restoreAll();
      } catch {
        // tinyspy not available or registry already empty — nothing to do.
      }
    }

    // Run teardown
    await Promise.all(cleanups.map((fn) => fn()));

    if (isolate !== true) {
      const { clearModuleCache } = options.context.outputModule
        ? await import('./loadEsModule')
        : await import('./loadModule');
      clearModuleCache();
    }

    isTeardown = true;
  };

  if (type === 'collect') {
    try {
      const {
        rstestContext,
        runner,
        rpc,
        cleanup,
        unhandledErrors,
        interopDefault,
        api,
      } = await preparePool(options);
      perFileApi = api;
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
      taskContext: preparedTaskContext,
    } = await preparePool(options, tracker);
    perFileApi = api;
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
    // Initialize coverage collector if coverage is enabled
    let coverageProvider: Awaited<
      ReturnType<typeof import('../../coverage').createCoverageProvider>
    > | null = null;
    if (options.context.runtimeConfig.coverage?.enabled) {
      const { createCoverageProvider } = await import('../../coverage');
      coverageProvider = await createCoverageProvider(
        options.context.runtimeConfig.coverage,
        options.context.rootPath,
      );
    }
    if (coverageProvider) {
      coverageProvider.init();
    }

    tracker.transition('load');
    const { assetFiles, sourceMaps: sourceMapsFromAssets } =
      assets || (await rpc.getAssetsByEntry());
    sourceMaps = sourceMapsFromAssets;

    cleanups.push(cleanup);

    rpc.onTestFileStart?.({
      testId: getFileTaskId(testPath),
      testPath,
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
        tracker,
      });
    } finally {
      taskContext.setFallback(undefined);
    }

    tracker.transition('tests');
    const results = await runner.runTests(
      testPath,
      {
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
        getCountOfFailedTests: async () => {
          return rpc.getCountOfFailedTests();
        },
      },
      api,
    );

    if (asyncLeakDetector) {
      if (api.rstest.isFakeTimers()) {
        api.rstest.useRealTimers();
      }
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

    // Collect coverage data after test file completes
    if (coverageProvider) {
      tracker.transition('coverage');
      const coverageMap = coverageProvider.collect();
      if (coverageMap) {
        // Attach coverage data to test result
        results.coverage = {};
        Object.entries(coverageMap.toJSON()).forEach(([key, value]) => {
          if ('toJSON' in value)
            results.coverage![key] = value.toJSON() as FileCoverageData;
          else results.coverage![key] = value;
        });
      }
      // Cleanup
      coverageProvider.cleanup();
    }

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
