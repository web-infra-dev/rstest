import type { BrowserDispatchResponse, BrowserRpcRequest } from '../types';

export const canPostMessageSource = (
  source: MessageEventSource | null,
): source is Window => {
  return (
    source !== null && typeof (source as Window).postMessage === 'function'
  );
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const hasString = (value: Record<string, unknown>, key: string): boolean => {
  return typeof value[key] === 'string';
};

export const readBrowserRpcRequest = (
  value: unknown,
): BrowserRpcRequest | null => {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (value.namespace !== 'browser' || value.method !== 'rpc') {
    return null;
  }

  const args = value.args;
  if (!isObjectRecord(args)) {
    return null;
  }

  if (
    !hasString(args, 'id') ||
    !hasString(args, 'kind') ||
    !hasString(args, 'method') ||
    !hasString(args, 'testPath') ||
    !hasString(args, 'runId')
  ) {
    return null;
  }

  return args as BrowserRpcRequest;
};

export const isStaleBrowserRpcRequest = (
  request: Pick<BrowserRpcRequest, 'runId'>,
  currentRunId?: string,
): boolean => {
  return !currentRunId || request.runId !== currentRunId;
};

export const createStaleBrowserRpcDispatchResponse = (
  dispatchRequestId: string,
  request: Pick<BrowserRpcRequest, 'kind' | 'method' | 'testPath' | 'runId'>,
  currentRunId?: string,
): BrowserDispatchResponse => {
  return {
    requestId: dispatchRequestId,
    stale: true,
    error:
      'Ignored stale browser RPC request from previous run: ' +
      `${request.kind}.${request.method} (testPath: ${request.testPath}, ` +
      `runId: ${request.runId}, currentRunId: ${currentRunId ?? 'none'})`,
  };
};
