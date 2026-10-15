import { describe, expect, it } from '@rstest/core';
import { PNG } from 'pngjs';
import type { BrowserRpcRequest } from '../src/protocol';
import { dispatchPlaywrightBrowserRpc } from '../src/providers/playwright/dispatchBrowserRpc';

class FakeLocator {
  actionCalls: Array<{ method: string; args: unknown[] }> = [];
  expectCalls: Array<{ method: string; options: Record<string, unknown> }> = [];
  screenshotCalls: Array<Record<string, unknown>> = [];
  screenshotImplementation = async (): Promise<Buffer> => {
    const png = new PNG({ width: 1, height: 1 });
    png.data.set([20, 80, 180, 255]);
    return PNG.sync.write(png);
  };

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

  async screenshot(options: Record<string, unknown>): Promise<Buffer> {
    this.screenshotCalls.push(options);
    return this.screenshotImplementation();
  }
}

class FakePage {
  constructor(private readonly locatorImpl: FakeLocator) {}

  locator(): FakeLocator {
    return this.locatorImpl;
  }
}

class FakeContainerPage {
  selector = '';
  readonly frame = new FakeLocator();

  locator(selector: string) {
    this.selector = selector;
    return { count: async () => 1 };
  }

  frameLocator(selector: string) {
    this.selector = selector;
    return this.frame;
  }
}

const createRequest = (
  overrides: Partial<BrowserRpcRequest>,
): BrowserRpcRequest => {
  return {
    id: 'rpc-1',
    testPath: '/tests/example.test.ts',
    projectName: 'default',
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

  it('routes headed requests to the iframe for their project', async () => {
    const containerPage = new FakeContainerPage();
    await dispatchPlaywrightBrowserRpc({
      containerPage: containerPage as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        projectName: 'project-a',
        args: ['button', { stabilityTimeout: 0 }],
      }),
      timeoutFallbackMs: 500,
    });

    expect(containerPage.selector).toContain("[data-test-project='project-a']");
  });

  it('escapes control characters in headed project selectors', async () => {
    const containerPage = new FakeContainerPage();
    await dispatchPlaywrightBrowserRpc({
      containerPage: containerPage as any,
      request: createRequest({
        projectName: "project\nname\r\f'\\",
      }),
      timeoutFallbackMs: 500,
    });

    expect(containerPage.selector).toContain(
      String.raw`[data-test-project='project\a name\d \c \'\\']`,
    );
  });

  it('bounds screenshot capture by the request timeout', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        timeout: 25,
        args: ['button', { stabilityTimeout: 0 }],
      }),
      timeoutFallbackMs: 500,
    });

    expect(fakeLocator.screenshotCalls).toHaveLength(1);
    expect(fakeLocator.screenshotCalls[0]?.timeout).toBeLessThanOrEqual(25);
  });

  it('rejects unsupported screenshot options before Playwright capture', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'screenshot',
          method: 'toMatchScreenshot',
          args: ['button', { path: '/outside/reference.png' }],
        }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Unsupported toMatchScreenshot option: path');
    expect(fakeLocator.screenshotCalls).toHaveLength(0);
  });

  it('rejects positive stability windows shorter than the capture minimum', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'screenshot',
          method: 'toMatchScreenshot',
          args: ['button', { stabilityTimeout: 50 }],
        }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('stabilityTimeout must be 0 or at least 100ms');
    expect(fakeLocator.screenshotCalls).toHaveLength(0);
  });

  it('does not add a deadline when screenshot timeouts are disabled', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        timeout: 0,
        args: ['button', { stabilityTimeout: 0 }],
      }),
      timeoutFallbackMs: 0,
    });

    expect(fakeLocator.screenshotCalls).toHaveLength(1);
    expect(fakeLocator.screenshotCalls[0]).not.toHaveProperty('timeout');
  });

  it('starts the stability window after the initial capture', async () => {
    const fakeLocator = new FakeLocator();
    let captures = 0;
    fakeLocator.screenshotImplementation = async () => {
      captures += 1;
      if (captures === 1) {
        await new Promise((resolve) => setTimeout(resolve, 550));
      }
      const png = new PNG({ width: 1, height: 1 });
      png.data.set([20, 80, 180, 255]);
      return PNG.sync.write(png);
    };

    const result = await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        timeout: 2000,
        args: ['button', { stabilityTimeout: 500 }],
      }),
      timeoutFallbackMs: 2000,
    });

    expect(typeof result).toBe('string');
    expect(captures).toBe(2);
  });

  it('bounds follow-up captures by the remaining stability timeout', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        timeout: 2000,
        args: ['button', { stabilityTimeout: 1000 }],
      }),
      timeoutFallbackMs: 2000,
    });

    expect(fakeLocator.screenshotCalls).toHaveLength(2);
    expect(fakeLocator.screenshotCalls[1]?.timeout).toBeLessThanOrEqual(1000);
    expect(fakeLocator.screenshotCalls[1]?.timeout).toBeGreaterThan(0);
  });

  it('rejects a follow-up capture that returns after the stability timeout', async () => {
    const fakeLocator = new FakeLocator();
    const captureScreenshot = fakeLocator.screenshotImplementation;
    let captures = 0;
    fakeLocator.screenshotImplementation = async () => {
      captures += 1;
      if (captures === 2) {
        await new Promise((resolve) => setTimeout(resolve, 275));
      }
      return captureScreenshot();
    };

    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'screenshot',
          method: 'toMatchScreenshot',
          timeout: 2000,
          args: ['button', { stabilityTimeout: 250 }],
        }),
        timeoutFallbackMs: 2000,
      }),
    ).rejects.toThrow('did not become stable within 250ms');
  });

  it('normalizes zero expect timeouts for Playwright', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'expect',
        method: 'toBeVisible',
        timeout: 0,
        timeoutIsExplicit: false,
      }),
      timeoutFallbackMs: 900,
    });

    expect(fakeLocator.expectCalls[0]?.options).toEqual({
      isNot: false,
      timeout: 1,
    });
  });

  it('preserves an explicit zero expect timeout', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'expect',
        method: 'toBeVisible',
        timeout: 0,
        timeoutIsExplicit: true,
      }),
      timeoutFallbackMs: 900,
    });

    expect(fakeLocator.expectCalls[0]?.options).toEqual({
      isNot: false,
      timeout: 0,
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
