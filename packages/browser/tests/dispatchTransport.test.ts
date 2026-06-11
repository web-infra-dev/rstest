import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import {
  DISPATCH_MESSAGE_TYPE,
  DISPATCH_NAMESPACE_RUNNER,
  DISPATCH_RPC_REQUEST_TYPE,
} from '../src/protocol';

const loadModule = () => import('../src/client/dispatchTransport');

describe('runner-lifecycle dispatch transport', () => {
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

    const { createRunnerLifecycleRequest, sendRunnerLifecycle } =
      await loadModule();
    const req = createRunnerLifecycleRequest('file-ready', { f: 1 });
    const onError = rstest.fn();
    sendRunnerLifecycle(req, onError);

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

    const { createRunnerLifecycleRequest, sendRunnerLifecycle } =
      await loadModule();
    const onError = rstest.fn();
    expect(() =>
      sendRunnerLifecycle(
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

    const { createRunnerLifecycleRequest, sendRunnerLifecycle } =
      await loadModule();
    const onError = rstest.fn();
    sendRunnerLifecycle(
      createRunnerLifecycleRequest('suite-result', null),
      onError,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it('posts the request to the parent window in the iframe path', async () => {
    const postMessage = rstest.fn();
    rstest.stubGlobal('window', { parent: { postMessage } });

    const { createRunnerLifecycleRequest, sendRunnerLifecycle } =
      await loadModule();
    const req = createRunnerLifecycleRequest('suite-start', { s: 1 });
    sendRunnerLifecycle(req);

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        type: DISPATCH_MESSAGE_TYPE,
        payload: { type: DISPATCH_RPC_REQUEST_TYPE, payload: req },
      },
      '*',
    );
  });
});
