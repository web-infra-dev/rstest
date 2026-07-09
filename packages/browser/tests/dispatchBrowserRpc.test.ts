import { describe, expect, it } from '@rstest/core';
import type { BrowserRpcRequest } from '../src/protocol';
import { dispatchPlaywrightBrowserRpc } from '../src/providers/playwright/dispatchBrowserRpc';

class FakeLocator {
  actionCalls: Array<{ method: string; args: unknown[] }> = [];
  expectCalls: Array<{ method: string; options: Record<string, unknown> }> = [];

  locator(): FakeLocator {
    return this;
  }

  filter(): FakeLocator {
    return this;
  }

  and(): FakeLocator {
    return this;
  }

  or(): FakeLocator {
    return this;
  }

  nth(): FakeLocator {
    return this;
  }

  first(): FakeLocator {
    return this;
  }

  last(): FakeLocator {
    return this;
  }

  async click(...args: unknown[]): Promise<string> {
    this.actionCalls.push({ method: 'click', args });
    return 'clicked';
  }

  async _expect(
    method: string,
    options: Record<string, unknown>,
  ): Promise<{ matches: boolean }> {
    this.expectCalls.push({ method, options });
    return { matches: !options.isNot };
  }
}

class FakePage {
  constructor(private readonly locatorImpl: FakeLocator) {}

  locator(): FakeLocator {
    return this.locatorImpl;
  }
}

const createRequest = (
  overrides: Partial<BrowserRpcRequest>,
): BrowserRpcRequest => {
  return {
    id: 'rpc-1',
    testPath: '/tests/example.test.ts',
    runId: 'run-1',
    kind: 'locator',
    locator: { steps: [{ type: 'locator', selector: '#root' }] },
    method: 'click',
    args: [],
    ...overrides,
  };
};

describe('dispatchPlaywrightBrowserRpc', () => {
  it('dispatches supported locator actions', async () => {
    const fakeLocator = new FakeLocator();
    const result = await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({ kind: 'locator', method: 'click', args: [123] }),
      timeoutFallbackMs: 500,
    });

    expect(result).toBe('clicked');
    expect(fakeLocator.actionCalls).toHaveLength(1);
    expect(fakeLocator.actionCalls[0]).toEqual({
      method: 'click',
      args: [123],
    });
  });

  it('rejects unsupported locator actions', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({ kind: 'locator', method: 'dragTo' }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Locator method not supported: dragTo');
  });

  it('dispatches supported expect matchers via _expect', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({ kind: 'expect', method: 'toBeVisible' }),
      timeoutFallbackMs: 900,
    });

    expect(fakeLocator.expectCalls).toHaveLength(1);
    expect(fakeLocator.expectCalls[0]?.method).toBe('to.be.visible');
    expect(fakeLocator.expectCalls[0]?.options).toEqual({
      isNot: false,
      timeout: 900,
    });
  });

  it('rejects unsupported expect matchers', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({ kind: 'expect', method: 'toHaveRole' }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Expect matcher not supported: toHaveRole');
  });

  it('validates matcher arguments for toHaveCount', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'expect',
          method: 'toHaveCount',
          args: ['1'],
        }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('toHaveCount expects a number, got string');
  });

  it('validates matcher arguments for toHaveCSS', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'expect',
          method: 'toHaveCSS',
          args: ['', { type: 'string', value: 'red' }],
        }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('toHaveCSS expects a CSS property name');
  });

  it('routes config requests and rejects unknown config methods', async () => {
    await expect(
      dispatchPlaywrightBrowserRpc({
        request: createRequest({
          kind: 'config',
          method: 'unknownConfigMethod',
          args: [],
        }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Unknown config method: unknownConfigMethod');
  });

  it('rejects requests missing testPath for locator/expect kinds', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({ testPath: '' }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Browser RPC request is missing testPath');
  });

  it('rejects unknown browser rpc kind', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({ kind: 'unknown' as any }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Unknown browser rpc kind: unknown');
  });
});
