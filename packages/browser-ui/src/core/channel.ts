import type {
  BrowserClientMessage,
  BrowserPluginRequestMessage,
  BrowserPluginResponseEnvelope,
  HostRPC,
  SnapshotRpcRequest,
  SnapshotRpcResponse,
} from '../types';

const DISPATCH_MESSAGE_TYPE = '__rstest_dispatch__';
const SNAPSHOT_RESPONSE_TYPE = '__rstest_snapshot_response__';
const PLUGIN_RESPONSE_TYPE = '__rstest_plugin_response__';

type SnapshotRpcHandler = Pick<
  HostRPC,
  | 'resolveSnapshotPath'
  | 'readSnapshotFile'
  | 'saveSnapshotFile'
  | 'removeSnapshotFile'
>;

type PluginRpcHandler = Pick<HostRPC, 'dispatch'>;

const canPostMessage = (
  sourceWindow: MessageEventSource | null,
): sourceWindow is Window => {
  return (
    sourceWindow !== null &&
    typeof (sourceWindow as Window).postMessage === 'function'
  );
};

export const readDispatchMessage = (
  event: MessageEvent,
): BrowserClientMessage | null => {
  if (event.data?.type !== DISPATCH_MESSAGE_TYPE) {
    return null;
  }
  return event.data.payload as BrowserClientMessage;
};

export const forwardSnapshotRpcRequest = async (
  rpc: SnapshotRpcHandler | null | undefined,
  request: SnapshotRpcRequest,
  sourceWindow: MessageEventSource | null,
): Promise<void> => {
  if (!rpc || !canPostMessage(sourceWindow)) {
    return;
  }

  const sendResponse = (response: SnapshotRpcResponse) => {
    sourceWindow.postMessage(
      { type: SNAPSHOT_RESPONSE_TYPE, payload: response },
      '*',
    );
  };

  try {
    let result: unknown;
    switch (request.method) {
      case 'resolveSnapshotPath':
        result = await rpc.resolveSnapshotPath(request.args.testPath);
        break;
      case 'readSnapshotFile':
        result = await rpc.readSnapshotFile(request.args.filepath);
        break;
      case 'saveSnapshotFile':
        result = await rpc.saveSnapshotFile(
          request.args.filepath,
          request.args.content,
        );
        break;
      case 'removeSnapshotFile':
        result = await rpc.removeSnapshotFile(request.args.filepath);
        break;
      default:
        result = undefined;
    }
    sendResponse({ id: request.id, result });
  } catch (error) {
    sendResponse({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const forwardPluginRpcRequest = async (
  rpc: PluginRpcHandler | null | undefined,
  request: BrowserPluginRequestMessage,
  sourceWindow: MessageEventSource | null,
): Promise<void> => {
  if (!canPostMessage(sourceWindow)) {
    return;
  }

  const sendResponse = (payload: BrowserPluginResponseEnvelope['payload']) => {
    sourceWindow.postMessage({ type: PLUGIN_RESPONSE_TYPE, payload }, '*');
  };

  const fallbackPayload = {
    namespace: request.payload.namespace,
    response: {
      id: request.payload.request.id,
      error: 'No plugin handler found for the current namespace.',
    },
  };

  if (!rpc) {
    sendResponse({
      namespace: request.payload.namespace,
      response: {
        id: request.payload.request.id,
        error: 'Container RPC is not ready for plugin dispatch.',
      },
    });
    return;
  }

  try {
    const result = await rpc.dispatch(request.payload.testFile, request);
    sendResponse(result ?? fallbackPayload);
  } catch (error) {
    sendResponse({
      namespace: request.payload.namespace,
      response: {
        id: request.payload.request.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
};
