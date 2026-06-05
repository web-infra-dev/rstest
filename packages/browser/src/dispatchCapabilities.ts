import type { Reporter } from '@rstest/core/internal/browser';
import { HostDispatchRouter } from './dispatchRouter';
import {
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_NAMESPACE_SNAPSHOT,
} from './protocol';
import type {
  BrowserClientMessage,
  BrowserDispatchHandler,
  BrowserDispatchRequest,
  RunnerDispatchMethod,
  SnapshotRpcMethod,
  SnapshotRpcMethodArgs,
  SnapshotRpcRequest,
} from './protocol';

export type HostDispatchRouterOptions = ConstructorParameters<
  typeof HostDispatchRouter
>[0];

type RunnerPayload<TType extends BrowserClientMessage['type']> =
  Extract<BrowserClientMessage, { type: TType }> extends {
    payload: infer TPayload;
  }
    ? TPayload
    : never;

type ReporterHookArg<THook extends keyof Reporter> =
  NonNullable<Reporter[THook]> extends (...args: infer TArgs) => unknown
    ? TArgs[0]
    : never;

type RunnerDispatchFileReadyPayload = ReporterHookArg<'onTestFileReady'>;
type RunnerDispatchSuiteStartPayload = ReporterHookArg<'onTestSuiteStart'>;
type RunnerDispatchSuiteResultPayload = ReporterHookArg<'onTestSuiteResult'>;
type RunnerDispatchCaseStartPayload = ReporterHookArg<'onTestCaseStart'>;

type RunnerDispatchCallbacks = {
  onTestFileStart: (payload: RunnerPayload<'file-start'>) => Promise<void>;
  onTestFileReady: (payload: RunnerDispatchFileReadyPayload) => Promise<void>;
  onTestSuiteStart: (payload: RunnerDispatchSuiteStartPayload) => Promise<void>;
  onTestSuiteResult: (
    payload: RunnerDispatchSuiteResultPayload,
  ) => Promise<void>;
  onTestCaseStart: (payload: RunnerDispatchCaseStartPayload) => Promise<void>;
  onTestCaseResult: (payload: RunnerPayload<'case-result'>) => Promise<void>;
  onTestFileComplete: (
    payload: RunnerPayload<'file-complete'>,
  ) => Promise<void>;
  onLog: (payload: RunnerPayload<'log'>) => Promise<void>;
  onFatal: (payload: RunnerPayload<'fatal'>) => Promise<void>;
};

type CreateHostDispatchRouterOptions = {
  routerOptions?: HostDispatchRouterOptions;
  runnerCallbacks: RunnerDispatchCallbacks;
  runSnapshotRpc: (request: SnapshotRpcRequest) => Promise<unknown>;
  extensionHandlers?: Map<string, BrowserDispatchHandler>;
  onDuplicateNamespace?: (namespace: string) => void;
};

/**
 * Builds a typed {@link SnapshotRpcRequest} from the untrusted wire envelope,
 * one builder per method. Keyed by {@link SnapshotRpcMethod}, so adding or
 * renaming a method in the union forces a matching entry here — a stale name
 * becomes a compile error instead of silently falling through to `null`. The
 * `args` casts are the unavoidable trust boundary for inbound wire data.
 */
const snapshotRequestBuilders: {
  [M in SnapshotRpcMethod]: (
    id: string,
    args: BrowserDispatchRequest['args'],
  ) => Extract<SnapshotRpcRequest, { method: M }>;
} = {
  resolveSnapshotPath: (id, args) => ({
    id,
    method: 'resolveSnapshotPath',
    args: args as SnapshotRpcMethodArgs['resolveSnapshotPath'],
  }),
  readSnapshotFile: (id, args) => ({
    id,
    method: 'readSnapshotFile',
    args: args as SnapshotRpcMethodArgs['readSnapshotFile'],
  }),
  saveSnapshotFile: (id, args) => ({
    id,
    method: 'saveSnapshotFile',
    args: args as SnapshotRpcMethodArgs['saveSnapshotFile'],
  }),
  removeSnapshotFile: (id, args) => ({
    id,
    method: 'removeSnapshotFile',
    args: args as SnapshotRpcMethodArgs['removeSnapshotFile'],
  }),
};

const toSnapshotRpcRequest = (
  request: BrowserDispatchRequest,
): SnapshotRpcRequest | null => {
  const builder = snapshotRequestBuilders[
    request.method as SnapshotRpcMethod
  ] as
    | ((id: string, args: BrowserDispatchRequest['args']) => SnapshotRpcRequest)
    | undefined;
  return builder ? builder(request.requestId, request.args) : null;
};

export const createHostDispatchRouter = ({
  routerOptions,
  runnerCallbacks,
  runSnapshotRpc,
  extensionHandlers,
  onDuplicateNamespace,
}: CreateHostDispatchRouterOptions): HostDispatchRouter => {
  const router = new HostDispatchRouter(routerOptions);

  // Keyed by RunnerDispatchMethod so adding a runner method to that union forces
  // a handler entry here (a missing key is a compile error) — the previous
  // `switch` with `default: break` silently dropped unhandled methods. The
  // `args` casts are checked against each callback's parameter type, so a wrong
  // payload type also fails to compile.
  const runnerMethodHandlers: {
    [M in RunnerDispatchMethod]: (
      args: BrowserDispatchRequest['args'],
    ) => Promise<void>;
  } = {
    'file-start': (args) =>
      runnerCallbacks.onTestFileStart(args as RunnerPayload<'file-start'>),
    'file-ready': (args) =>
      runnerCallbacks.onTestFileReady(args as RunnerDispatchFileReadyPayload),
    'suite-start': (args) =>
      runnerCallbacks.onTestSuiteStart(args as RunnerDispatchSuiteStartPayload),
    'suite-result': (args) =>
      runnerCallbacks.onTestSuiteResult(
        args as RunnerDispatchSuiteResultPayload,
      ),
    'case-start': (args) =>
      runnerCallbacks.onTestCaseStart(args as RunnerDispatchCaseStartPayload),
    'case-result': (args) =>
      runnerCallbacks.onTestCaseResult(args as RunnerPayload<'case-result'>),
    'file-complete': (args) =>
      runnerCallbacks.onTestFileComplete(
        args as RunnerPayload<'file-complete'>,
      ),
    log: (args) => runnerCallbacks.onLog(args as RunnerPayload<'log'>),
    fatal: (args) => runnerCallbacks.onFatal(args as RunnerPayload<'fatal'>),
  };

  router.register(
    DISPATCH_NAMESPACE_RUNNER,
    async (request: BrowserDispatchRequest) => {
      // `request.method` is untrusted wire data, so the lookup may miss. Unknown
      // methods are ignored for forward-compatibility with newer runners,
      // matching the previous `default: break`.
      await runnerMethodHandlers[request.method as RunnerDispatchMethod]?.(
        request.args,
      );
    },
  );

  router.register(
    DISPATCH_NAMESPACE_SNAPSHOT,
    async (request: BrowserDispatchRequest) => {
      const snapshotRequest = toSnapshotRpcRequest(request);
      if (!snapshotRequest) {
        return undefined;
      }
      return runSnapshotRpc(snapshotRequest);
    },
  );

  for (const [namespace, handler] of extensionHandlers ?? []) {
    if (router.has(namespace)) {
      onDuplicateNamespace?.(namespace);
      continue;
    }

    router.register(namespace, handler);
  }

  return router;
};
