import type { Reporter } from '@rstest/core/internal/browser';
import { HostDispatchRouter } from './dispatchRouter';
import type {
  BrowserClientMessage,
  BrowserDispatchHandler,
  BrowserDispatchRequest,
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

  router.register('runner', async (request: BrowserDispatchRequest) => {
    switch (request.method) {
      case 'file-start':
        await runnerCallbacks.onTestFileStart(
          request.args as RunnerPayload<'file-start'>,
        );
        break;
      case 'file-ready':
        await runnerCallbacks.onTestFileReady(
          request.args as RunnerDispatchFileReadyPayload,
        );
        break;
      case 'suite-start':
        await runnerCallbacks.onTestSuiteStart(
          request.args as RunnerDispatchSuiteStartPayload,
        );
        break;
      case 'suite-result':
        await runnerCallbacks.onTestSuiteResult(
          request.args as RunnerDispatchSuiteResultPayload,
        );
        break;
      case 'case-start':
        await runnerCallbacks.onTestCaseStart(
          request.args as RunnerDispatchCaseStartPayload,
        );
        break;
      case 'case-result':
        await runnerCallbacks.onTestCaseResult(
          request.args as RunnerPayload<'case-result'>,
        );
        break;
      case 'file-complete':
        await runnerCallbacks.onTestFileComplete(
          request.args as RunnerPayload<'file-complete'>,
        );
        break;
      case 'log':
        await runnerCallbacks.onLog(request.args as RunnerPayload<'log'>);
        break;
      case 'fatal':
        await runnerCallbacks.onFatal(request.args as RunnerPayload<'fatal'>);
        break;
      default:
        break;
    }
  });

  router.register('snapshot', async (request: BrowserDispatchRequest) => {
    const snapshotRequest = toSnapshotRpcRequest(request);
    if (!snapshotRequest) {
      return undefined;
    }
    return runSnapshotRpc(snapshotRequest);
  });

  for (const [namespace, handler] of extensionHandlers ?? []) {
    if (router.has(namespace)) {
      onDuplicateNamespace?.(namespace);
      continue;
    }

    router.register(namespace, handler);
  }

  return router;
};
