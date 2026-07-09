import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_RESPONSE_TYPE,
} from '@rstest/browser/protocol';
import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
  HostRPC,
} from '../types';

type DispatchRpcHandler = Pick<HostRPC, 'dispatch'>;

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

const toDispatchErrorResponse = (
  requestId: string,
  error: unknown,
): BrowserDispatchResponse => {
  return {
    requestId,
    error: error instanceof Error ? error.message : String(error),
  };
};

const getDispatchRequestId = (value: unknown): string => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'requestId' in value &&
    typeof (value as { requestId: unknown }).requestId === 'string'
  ) {
    return (value as { requestId: string }).requestId;
  }
  return 'unknown-request';
};

const isDispatchRequest = (value: unknown): value is BrowserDispatchRequest => {
  return getDispatchRequestId(value) !== 'unknown-request';
};

export const forwardDispatchRpcRequest = async (
  rpc: DispatchRpcHandler | null | undefined,
  request: unknown,
  sourceWindow: MessageEventSource | null,
): Promise<void> => {
  // Container-side generic dispatch proxy:
  // runner iframe -> browser-ui -> host birpc dispatch(request).
  if (!canPostMessage(sourceWindow)) {
    return;
  }

  const sendResponse = (response: BrowserDispatchResponse) => {
    sourceWindow.postMessage(
      { type: DISPATCH_RESPONSE_TYPE, payload: response },
      '*',
    );
  };

  if (!isDispatchRequest(request)) {
    sendResponse({
      requestId: getDispatchRequestId(request),
      error:
        'Invalid dispatch request payload: expected an object with string requestId.',
    });
    return;
  }

  if (!rpc) {
    sendResponse({
      requestId: request.requestId,
      error: 'Container RPC is not ready for dispatch.',
    });
    return;
  }

  try {
    sendResponse(await rpc.dispatch(request));
  } catch (error) {
    sendResponse(toDispatchErrorResponse(request.requestId, error));
  }
};
