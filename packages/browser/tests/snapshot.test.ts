import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  rstest,
} from '@rstest/core';

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
          type: '__rstest_snapshot_response__',
          payload: { id, result },
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
    const requestId = call[0].payload.payload.id;

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
    const requestId = call[0].payload.payload.id;
    const payload = call[0].payload.payload;

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
    const requestId = call[0].payload.payload.id;
    const payload = call[0].payload.payload;

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
    const requestId = call[0].payload.payload.id;

    simulateRpcResponse(requestId, null);

    const result = await readPromise;
    expect(result).toBeNull();
  });

  it('should remove snapshot via RPC', async () => {
    const env = new BrowserSnapshotEnvironment();

    const removePromise = env.removeSnapshotFile('/test/snapshot.snap');

    expect(mockPostMessage).toHaveBeenCalled();
    const call = mockPostMessage.mock.calls[0];
    const requestId = call[0].payload.payload.id;
    const payload = call[0].payload.payload;

    expect(payload.method).toBe('removeSnapshotFile');
    expect(payload.args).toEqual({ filepath: '/test/snapshot.snap' });

    simulateRpcResponse(requestId, undefined);
    await removePromise;
  });
});
