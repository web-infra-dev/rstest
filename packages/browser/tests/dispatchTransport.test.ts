import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_RPC_REQUEST_TYPE,
  NO_RPC_TIMEOUT,
} from '../src/protocol';

const loadModule = () => import('../src/client/dispatchTransport');

describe('dispatch transport', () => {
  afterEach(() => {
    rstest.unstubAllGlobals();
    rstest.resetModules();
  });

  it('builds a runner-namespace envelope with a unique request id', async () => {
    rstest.stubGlobal('window', { parent: {} });
    const { createRunnerLifecycleRequest } = await loadModule();

    const req = createRunnerLifecycleRequest('suite-start', { a: 1 });
    expect(req.namespace).toBe(DISPATCH_NAMESPACE_RUNNER);
    expect(req.method).toBe('suite-start');
    expect(req.args).toEqual({ a: 1 });
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(0);

    const req2 = createRunnerLifecycleRequest('case-start', undefined);
    expect(req2.requestId).not.toBe(req.requestId);
  });

  it('delivers fire-and-forget to the top-level dispatch bridge', async () => {
    const bridge = rstest.fn(() => Promise.resolve({ requestId: 'x' }));
    const win: any = { __rstest_dispatch_rpc__: bridge };
    win.parent = win;
    rstest.stubGlobal('window', win);

    const { createRunnerLifecycleRequest, sendDispatchRequest } =
      await loadModule();
    const req = createRunnerLifecycleRequest('file-ready', { f: 1 });
    const onError = rstest.fn();
    sendDispatchRequest(req, onError);

    expect(bridge).toHaveBeenCalledTimes(1);
    expect(bridge).toHaveBeenCalledWith(req);
    expect(onError).not.toHaveBeenCalled();
  });

  it('routes a rejecting bridge to onError without throwing', async () => {
    const failure = new Error('bridge boom');
    const bridge = rstest.fn(() => Promise.reject(failure));
    const win: any = { __rstest_dispatch_rpc__: bridge };
    win.parent = win;
    rstest.stubGlobal('window', win);

    const { createRunnerLifecycleRequest, sendDispatchRequest } =
      await loadModule();
    const onError = rstest.fn();
    expect(() =>
      sendDispatchRequest(
        createRunnerLifecycleRequest('case-start', null),
        onError,
      ),
    ).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('reports a missing top-level bridge through onError', async () => {
    const win: any = { __rstest_dispatch_rpc__: undefined };
    win.parent = win;
    rstest.stubGlobal('window', win);

    const { createRunnerLifecycleRequest, sendDispatchRequest } =
      await loadModule();
    const onError = rstest.fn();
    sendDispatchRequest(
      createRunnerLifecycleRequest('suite-result', null),
      onError,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('posts an identity envelope to the parent window in the iframe path', async () => {
    const postMessage = rstest.fn();
    rstest.stubGlobal('window', { parent: { postMessage } });

    const { adoptRunIdentity } = await import('../src/client/runIdentity');
    adoptRunIdentity('run-9');
    const { createRunnerLifecycleRequest, sendDispatchRequest } =
      await loadModule();
    const req = createRunnerLifecycleRequest('suite-start', { s: 1 });
    sendDispatchRequest(req);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: DISPATCH_MESSAGE_TYPE,
        payload: {
          runId: 'run-9',
          message: {
            type: DISPATCH_RPC_REQUEST_TYPE,
            payload: { ...req, runId: 'run-9' },
          },
        },
      },
      '*',
    );
  });

  it('does not time out disabled RPCs and rejects them when disposed', async () => {
    rstest.useFakeTimers();
    try {
      const listeners = new Map<string, (event: MessageEvent) => void>();
      const removeEventListener = rstest.fn((type: string) => {
        listeners.delete(type);
      });
      const win = {
        addEventListener: (
          type: string,
          handler: (event: MessageEvent) => void,
        ) => {
          listeners.set(type, handler);
        },
        removeEventListener,
        parent: { postMessage: rstest.fn() },
      };
      rstest.stubGlobal('window', win);

      const { dispatchRpc, disposeDispatchTransport } = await loadModule();
      const requestPromise = dispatchRpc<void>({
        requestId: 'rpc-1',
        request: {
          requestId: 'rpc-1',
          namespace: DISPATCH_NAMESPACE_RUNNER,
          method: 'file-ready',
          args: undefined,
        },
        timeoutMs: NO_RPC_TIMEOUT,
        timeoutMessage: 'should not time out',
        staleMessage: 'should not be stale',
      });

      await rstest.advanceTimersByTimeAsync(60_000);
      const disposed = new Error('transport closed');
      disposeDispatchTransport(disposed);

      await expect(requestPromise).rejects.toBe(disposed);
      expect(removeEventListener).toHaveBeenCalledWith(
        'message',
        expect.any(Function),
      );
    } finally {
      rstest.useRealTimers();
    }
  });

  it('keeps framework RPCs on a finite watchdog outside test execution', async () => {
    rstest.stubGlobal('window', {
      __RSTEST_BROWSER_OPTIONS__: { rpcTimeout: NO_RPC_TIMEOUT },
      parent: {},
    });
    const { getRpcTimeout, setRpcPhase } = await loadModule();

    setRpcPhase('framework');
    expect(getRpcTimeout()).toBe(30_000);
    expect(getRpcTimeout('framework')).toBe(30_000);

    setRpcPhase('test');
    expect(getRpcTimeout()).toBe(NO_RPC_TIMEOUT);
    expect(getRpcTimeout('framework')).toBe(30_000);
  });
});
