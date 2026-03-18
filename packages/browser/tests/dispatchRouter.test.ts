import { describe, expect, it, rstest } from '@rstest/core';
import { HostDispatchRouter } from '../src/dispatchRouter';
import type { BrowserDispatchRequest } from '../src/protocol';

const createRequest = (
  overrides: Partial<BrowserDispatchRequest> = {},
): BrowserDispatchRequest => {
  return {
    requestId: 'req-1',
    namespace: 'runner',
    method: 'file-start',
    ...overrides,
  };
};

describe('host dispatch router', () => {
  it('should dispatch to registered namespace', async () => {
    const router = new HostDispatchRouter();
    const handler = rstest.fn().mockResolvedValue('ok');
    router.register('runner', handler);

    const response = await router.dispatch(createRequest());

    expect(handler).toHaveBeenCalled();
    expect(response.result).toBe('ok');
    expect(response.error).toBeUndefined();
  });

  it('should return error for missing namespace', async () => {
    const router = new HostDispatchRouter();

    const response = await router.dispatch(createRequest());

    expect(response.error).toContain('No dispatch handler registered');
  });

  it('should mark stale requests', async () => {
    const staleSpy = rstest.fn();
    const handler = rstest.fn().mockResolvedValue('ok');
    const router = new HostDispatchRouter({
      isRunTokenStale: () => true,
      onStale: staleSpy,
    });
    router.register('runner', handler);

    const response = await router.dispatch(
      createRequest({
        runToken: 1,
      }),
    );

    expect(response.stale).toBe(true);
    expect(staleSpy).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });
});
