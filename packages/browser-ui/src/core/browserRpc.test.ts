import { describe, expect, it } from '@rstest/core';
import {
  createStaleBrowserRpcDispatchResponse,
  isStaleBrowserRpcRequest,
  readBrowserRpcRequest,
} from './browserRpc';

describe('browser rpc helpers', () => {
  it('should read browser rpc payload from dispatch request', () => {
    const request = readBrowserRpcRequest({
      requestId: 'dispatch-1',
      namespace: 'browser',
      method: 'rpc',
      args: {
        id: 'rpc-1',
        testPath: '/tests/example.test.ts',
        runId: 'run-1',
        kind: 'locator',
        locator: { steps: [] },
        method: 'click',
        args: [],
      },
    });

    expect(request).toBeTruthy();
    expect(request?.testPath).toBe('/tests/example.test.ts');
    expect(request?.runId).toBe('run-1');
  });

  it('should return null for non-browser dispatch requests', () => {
    const request = readBrowserRpcRequest({
      requestId: 'dispatch-2',
      namespace: 'snapshot',
      method: 'readSnapshotFile',
      args: {
        filepath: '/tmp/a.snap',
      },
    });

    expect(request).toBeNull();
  });

  it('should detect stale browser rpc request by runId', () => {
    expect(isStaleBrowserRpcRequest({ runId: 'run-1' }, 'run-2')).toBe(true);
    expect(isStaleBrowserRpcRequest({ runId: 'run-1' }, 'run-1')).toBe(false);
    expect(isStaleBrowserRpcRequest({ runId: 'run-1' }, undefined)).toBe(true);
  });

  it('should create stale dispatch response envelope', () => {
    const response = createStaleBrowserRpcDispatchResponse(
      'dispatch-3',
      {
        kind: 'expect',
        method: 'toBeVisible',
        testPath: '/tests/example.test.ts',
        runId: 'run-old',
      },
      'run-new',
    );

    expect(response.requestId).toBe('dispatch-3');
    expect(response.stale).toBe(true);
    expect(response.error).toContain('run-old');
    expect(response.error).toContain('run-new');
  });
});
