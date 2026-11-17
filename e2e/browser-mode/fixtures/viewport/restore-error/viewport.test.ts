import { page } from '@rstest/browser';
import { test } from '@rstest/core';

test('reports a failed viewport restore', async () => {
  await page.viewport(600, 400);
  // Test-only access to the headless transport to simulate a restore failure.
  const browserWindow = window as Window & {
    __rstest_dispatch_rpc__?: (request: { args?: unknown }) => Promise<unknown>;
  };
  const dispatch = browserWindow.__rstest_dispatch_rpc__;
  if (!dispatch) throw new Error('Expected a headless browser transport.');
  browserWindow.__rstest_dispatch_rpc__ = (request) => {
    const args = request.args;
    if (
      args &&
      typeof args === 'object' &&
      'kind' in args &&
      args.kind === 'viewport'
    ) {
      return Promise.reject(new Error('VIEWPORT_RESTORE_REJECTED'));
    }
    return dispatch(request);
  };
});

test('ends cleanup with a pending viewport request', async () => {
  // Test-only transport access keeps a resize pending beyond the test body.
  const browserWindow = window as Window & {
    __rstest_dispatch_rpc__?: (request: { args?: unknown }) => Promise<unknown>;
    __RSTEST_BROWSER_OPTIONS__?: { rpcTimeout?: number };
  };
  const dispatch = browserWindow.__rstest_dispatch_rpc__;
  if (!dispatch) throw new Error('Expected a headless browser transport.');
  let markStarted: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  browserWindow.__rstest_dispatch_rpc__ = (request) => {
    const args = request.args;
    if (
      args &&
      typeof args === 'object' &&
      'kind' in args &&
      args.kind === 'viewport'
    ) {
      markStarted();
      return new Promise(() => {});
    }
    return dispatch(request);
  };
  void page.viewport(610, 410).catch(() => {});
  await started;
  const options = browserWindow.__RSTEST_BROWSER_OPTIONS__;
  if (!options) throw new Error('Expected browser runtime options.');
  options.rpcTimeout = 100;
  console.log('VIEWPORT_PENDING_STARTED');
});

test('must not run in the contaminated viewport', () => {
  console.log('VIEWPORT_CONTAMINATED_TEST_RAN');
});
