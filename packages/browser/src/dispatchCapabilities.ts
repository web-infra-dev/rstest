import { HostDispatchRouter } from './dispatchRouter';
import type {
  BrowserClientMessage,
  BrowserDispatchHandler,
  BrowserDispatchRequest,
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

export type RunnerDispatchCallbacks = {
  onTestFileStart: (payload: RunnerPayload<'file-start'>) => Promise<void>;
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

const toSnapshotRpcRequest = (
  request: BrowserDispatchRequest,
): SnapshotRpcRequest | null => {
  switch (request.method) {
    case 'resolveSnapshotPath':
      return {
        id: request.requestId,
        method: 'resolveSnapshotPath',
        args: request.args as { testPath: string },
      };
    case 'readSnapshotFile':
      return {
        id: request.requestId,
        method: 'readSnapshotFile',
        args: request.args as { filepath: string },
      };
    case 'saveSnapshotFile':
      return {
        id: request.requestId,
        method: 'saveSnapshotFile',
        args: request.args as { filepath: string; content: string },
      };
    case 'removeSnapshotFile':
      return {
        id: request.requestId,
        method: 'removeSnapshotFile',
        args: request.args as { filepath: string },
      };
    default:
      return null;
  }
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
