import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';
import {
  DISPATCH_NAMESPACE_SNAPSHOT,
  DISPATCH_RESPONSE_TYPE,
  DISPATCH_RPC_REQUEST_TYPE,
} from '../src/protocol';

describe('BrowserSnapshotEnvironment', () => {
  let BrowserSnapshotEnvironment: any;
  let mockPostMessage: any;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(async () => {
    // Reset modules to get fresh state for messageListenerInitialized
    rstest.resetModules();

    mockPostMessage = rstest.fn();

    // Mock window object for RPC communication before importing the module
    rstest.stubGlobal('window', {
      addEventListener: (
        _type: string,
        handler: (event: MessageEvent) => void,
      ) => {
        messageHandler = handler;
      },
      parent: {
        postMessage: mockPostMessage,
      },
    });

    // Dynamic import to get fresh module with mocked window
    const module = await import('../src/client/snapshot');
    BrowserSnapshotEnvironment = module.BrowserSnapshotEnvironment;
  });

  afterEach(() => {
    rstest.unstubAllGlobals();
    messageHandler = null;
  });

  // Helper to simulate RPC response
  const simulateRpcResponse = (id: string, result: unknown) => {
    if (messageHandler) {
      messageHandler({
        data: {
          type: DISPATCH_RESPONSE_TYPE,
          payload: { requestId: id, result },
        },
      } as MessageEvent);
    }
  };

  it('should create an instance', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env).toBeInstanceOf(BrowserSnapshotEnvironment);
  });

  it('should return version', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env.getVersion()).toBe('1');
  });

  it('should return header', () => {
    const env = new BrowserSnapshotEnvironment();
    expect(env.getHeader()).toBe('// Rstest Snapshot v1');
  });

  it('should resolve raw path', async () => {
    const env = new BrowserSnapshotEnvironment();
    const result = await env.resolveRawPath('/test/path', '/raw/path');
    expect(result).toBe('/raw/path');
  });

  it('should prepare directory without error', async () => {
    const env = new BrowserSnapshotEnvironment();
    await expect(env.prepareDirectory()).resolves.toBeUndefined();
  });

  it('should resolve path via RPC', async () => {
    const env = new BrowserSnapshotEnvironment();

    const resultPromise = env.resolvePath('/test/file');

    // Get the request ID from the postMessage call
    expect(mockPostMessage).toHaveBeenCalled();
    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.requestId;

    // Simulate response
    simulateRpcResponse(requestId, '/test/file.snap');

    const result = await resultPromise;
    expect(result).toBe('/test/file.snap');
  });

  it('should save snapshot via RPC', async () => {
    const env = new BrowserSnapshotEnvironment();

    const savePromise = env.saveSnapshotFile('/test/snapshot.snap', 'content');

    expect(mockPostMessage).toHaveBeenCalled();
    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.requestId;
    const payload = call[0].payload.payload;

    expect(call[0].payload.type).toBe(DISPATCH_RPC_REQUEST_TYPE);
    expect(payload.namespace).toBe(DISPATCH_NAMESPACE_SNAPSHOT);
    expect(payload.method).toBe('saveSnapshotFile');
    expect(payload.args).toEqual({
      filepath: '/test/snapshot.snap',
      content: 'content',
    });

    simulateRpcResponse(requestId, undefined);
    await savePromise;
  });

  it('should read snapshot via RPC', async () => {
    const env = new BrowserSnapshotEnvironment();

    const readPromise = env.readSnapshotFile('/test/snapshot.snap');

    expect(mockPostMessage).toHaveBeenCalled();
    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.requestId;
    const payload = call[0].payload.payload;

    expect(call[0].payload.type).toBe(DISPATCH_RPC_REQUEST_TYPE);
    expect(payload.namespace).toBe(DISPATCH_NAMESPACE_SNAPSHOT);
    expect(payload.method).toBe('readSnapshotFile');
    expect(payload.args).toEqual({ filepath: '/test/snapshot.snap' });

    simulateRpcResponse(requestId, 'snapshot content');

    const result = await readPromise;
    expect(result).toBe('snapshot content');
  });

  it('should return null for non-existent snapshot', async () => {
    const env = new BrowserSnapshotEnvironment();

    const readPromise = env.readSnapshotFile('/non-existent');

    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.requestId;

    simulateRpcResponse(requestId, null);

    const result = await readPromise;
    expect(result).toBeNull();
  });

  it('should remove snapshot via RPC', async () => {
    const env = new BrowserSnapshotEnvironment();

    const removePromise = env.removeSnapshotFile('/test/snapshot.snap');

    expect(mockPostMessage).toHaveBeenCalled();
    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.requestId;
    const payload = call[0].payload.payload;

    expect(call[0].payload.type).toBe(DISPATCH_RPC_REQUEST_TYPE);
    expect(payload.namespace).toBe(DISPATCH_NAMESPACE_SNAPSHOT);
    expect(payload.method).toBe('removeSnapshotFile');
    expect(payload.args).toEqual({ filepath: '/test/snapshot.snap' });

    simulateRpcResponse(requestId, undefined);
    await removePromise;
  });
});

describe('BrowserSnapshotEnvironment (top-level bridge)', () => {
  let BrowserSnapshotEnvironment: any;
  let mockSnapshotRpc: any;

  beforeEach(async () => {
    rstest.resetModules();
    mockSnapshotRpc = rstest.fn();

    const windowMock: Record<string, unknown> = {
      addEventListener: rstest.fn(),
      __RSTEST_BROWSER_OPTIONS__: {
        rpcTimeout: 50,
      },
      __rstest_dispatch_rpc__: mockSnapshotRpc,
    };
    windowMock.parent = windowMock;

    rstest.stubGlobal('window', windowMock);

    const module = await import('../src/client/snapshot');
    BrowserSnapshotEnvironment = module.BrowserSnapshotEnvironment;
  });

  afterEach(() => {
    rstest.unstubAllGlobals();
  });

  it('should resolve path via top-level bridge', async () => {
    const env = new BrowserSnapshotEnvironment();
    mockSnapshotRpc.mockImplementation((request: { requestId: string }) =>
      Promise.resolve({
        requestId: request.requestId,
        result: '/test/file.snap',
      }),
    );

    await expect(env.resolvePath('/test/file.ts')).resolves.toBe(
      '/test/file.snap',
    );
    expect(mockSnapshotRpc).toHaveBeenCalled();
    const request = mockSnapshotRpc.mock.calls[0][0];
    expect(request.method).toBe('resolveSnapshotPath');
    expect(request.args).toEqual({ testPath: '/test/file.ts' });
  });

  it('should surface top-level bridge errors', async () => {
    const env = new BrowserSnapshotEnvironment();
    mockSnapshotRpc.mockRejectedValue(new Error('snapshot bridge failed'));

    await expect(env.readSnapshotFile('/a.snap')).rejects.toThrow(
      'snapshot bridge failed',
    );
  });

  it('should timeout when top-level bridge does not respond', async () => {
    const env = new BrowserSnapshotEnvironment();
    mockSnapshotRpc.mockImplementation(
      () => new Promise(() => undefined) as Promise<unknown>,
    );

    await expect(env.removeSnapshotFile('/a.snap')).rejects.toThrow(
      'Snapshot RPC timeout',
    );
  });
});

describe('BrowserSnapshotEnvironment (top-level without bridge)', () => {
  let BrowserSnapshotEnvironment: any;

  beforeEach(async () => {
    rstest.resetModules();

    const windowMock: Record<string, unknown> = {
      addEventListener: rstest.fn(),
    };
    windowMock.parent = windowMock;

    rstest.stubGlobal('window', windowMock);

    const module = await import('../src/client/snapshot');
    BrowserSnapshotEnvironment = module.BrowserSnapshotEnvironment;
  });

  afterEach(() => {
    rstest.unstubAllGlobals();
  });

  it('should throw when bridge is missing in top-level mode', async () => {
    const env = new BrowserSnapshotEnvironment();
    await expect(env.resolvePath('/test/file.ts')).rejects.toThrow(
      'Dispatch RPC bridge is not available in top-level runner.',
    );
  });
});
