import { afterEach, describe, expect, it, rstest } from '@rstest/core';
import type { BrowserDispatchRequest } from '../src/protocol';
import type { BrowserRpcRequest } from '../src/rpcProtocol';

describe('browser RPC', () => {
  afterEach(() => {
    rstest.unstubAllGlobals();
    rstest.resetModules();
  });

  it('omits missing keyboard options from RPC args', async () => {
    const dispatch = rstest.fn((request: BrowserDispatchRequest) =>
      Promise.resolve({ requestId: request.requestId }),
    );
    const win: any = {
      __RSTEST_BROWSER_OPTIONS__: {
        projectName: 'default',
        testFile: '/tests/keyboard.test.ts',
      },
      __rstest_dispatch_rpc__: dispatch,
    };
    win.parent = win;
    rstest.stubGlobal('window', win);

    const { keyboard } = await import('../src/client/keyboard');
    await keyboard.press('b');
    await keyboard.tab();
    await keyboard.press('Escape', { delay: 10 });

    expect(
      dispatch.mock.calls.map(
        ([request]) => (request.args as BrowserRpcRequest).args,
      ),
    ).toEqual([['b'], ['Tab'], ['Escape', { delay: 10 }]]);
  });

  it('preserves an empty project name in browser RPC requests', async () => {
    const dispatch = rstest.fn((request: BrowserDispatchRequest) =>
      Promise.resolve({ requestId: request.requestId }),
    );
    const win: any = {
      __RSTEST_BROWSER_OPTIONS__: {
        projectName: '',
        testFile: '/tests/empty-project.test.ts',
      },
      __rstest_dispatch_rpc__: dispatch,
    };
    win.parent = win;
    rstest.stubGlobal('window', win);

    const { callBrowserRpc } = await import('../src/client/browserRpc');
    await callBrowserRpc({
      kind: 'locator',
      locator: { steps: [] },
      method: 'count',
      args: [],
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0].target?.projectName).toBe('');
  });
});
