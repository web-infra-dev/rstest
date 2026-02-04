import type { BrowserRpcRequest, BrowserRpcResponse } from '../types';

export const canPostMessageSource = (
  source: MessageEventSource | null,
): source is Window => {
  return (
    source !== null && typeof (source as Window).postMessage === 'function'
  );
};

export const isStaleBrowserRpcRequest = (
  request: Pick<BrowserRpcRequest, 'runId'>,
  currentRunId?: string,
): boolean => {
  return !currentRunId || request.runId !== currentRunId;
};

export const createStaleBrowserRpcResponse = (
  request: Pick<
    BrowserRpcRequest,
    'id' | 'kind' | 'method' | 'testPath' | 'runId'
  >,
  currentRunId?: string,
): BrowserRpcResponse => {
  return {
    id: request.id,
    error:
      'Ignored stale browser RPC request from previous run: ' +
      `${request.kind}.${request.method} (testPath: ${request.testPath}, ` +
      `runId: ${request.runId}, currentRunId: ${currentRunId ?? 'none'})`,
  };
};
