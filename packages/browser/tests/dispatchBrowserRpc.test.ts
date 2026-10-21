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
  onAction?: (method: string) => void;

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
    this.onAction?.('click');
    return 'clicked';
  }

  async focus(): Promise<void> {
    this.actionCalls.push({ method: 'focus', args: [] });
    this.onAction?.('focus');
  }

  async dragTo(...args: unknown[]): Promise<string> {
    this.actionCalls.push({ method: 'dragTo', args });
    return 'dragged';
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
  keyboardCalls: unknown[][] = [];
  keyboard = {
    press: async (...args: unknown[]) => {
      this.keyboardCalls.push(args);
    },
  };
  constructor(private readonly locatorImpl: FakeLocator) {}

  locator(): FakeLocator {
    return this.locatorImpl;
  }
}

class FakeContainerPage {
  selector = '';
  readonly frame = new FakeLocator();
  keyboardCalls: unknown[][] = [];
  focusChecks = 0;
  readonly keyboardEvents: string[] = [];
  onFocus?: (selector: string) => Promise<void>;
  onPress?: (key: string) => Promise<void>;
  keyboard = {
    press: async (...args: unknown[]) => {
      this.keyboardCalls.push(args);
      const key = String(args[0]);
      this.keyboardEvents.push(`press:start:${key}`);
      await this.onPress?.(key);
      this.keyboardEvents.push(`press:end:${key}`);
    },
  };

  locator(selector: string) {
    this.selector = selector;
    return {
      count: async () => 1,
      evaluate: async () => {
        this.focusChecks++;
        this.keyboardEvents.push(`focus:${selector}`);
        await this.onFocus?.(selector);
      },
    };
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
  it('dispatches keyboard presses without resolving a locator', async () => {
    const fakePage = new FakePage(new FakeLocator());
    fakePage.locator = () => {
      throw new Error('Keyboard must not resolve a locator');
    };
    await dispatchPlaywrightBrowserRpc({
      runnerPage: fakePage as any,
      request: createRequest({
        kind: 'keyboard',
        method: 'press',
        args: ['ControlOrMeta+A', { delay: 10 }],
      }),
      timeoutFallbackMs: 500,
    });
    expect(fakePage.keyboardCalls).toEqual([
      ['ControlOrMeta+A', { delay: 10 }],
    ]);
  });

  it('routes headed keyboard presses through the requested runner frame', async () => {
    const fakePage = new FakeContainerPage();
    await dispatchPlaywrightBrowserRpc({
      containerPage: fakePage as any,
      request: createRequest({
        kind: 'keyboard',
        method: 'press',
        args: ['Tab'],
      }),
      timeoutFallbackMs: 500,
    });
    expect(fakePage.selector).toContain("data-test-project='default'");
    expect(fakePage.selector).toContain(
      "data-test-file='/tests/example.test.ts'",
    );
    expect(fakePage.focusChecks).toBe(1);
    expect(fakePage.keyboardCalls).toEqual([['Tab', undefined]]);
  });

  it('serializes headed focus and keyboard presses per page', async () => {
    const fakePage = new FakeContainerPage();
    let releaseFirstFocus = () => {};
    const firstFocus = new Promise<void>((resolve) => {
      releaseFirstFocus = resolve;
    });
    let firstFocusStarted = () => {};
    const firstFocusStartedPromise = new Promise<void>((resolve) => {
      firstFocusStarted = resolve;
    });
    let releaseFirstPress = () => {};
    const firstPress = new Promise<void>((resolve) => {
      releaseFirstPress = resolve;
    });
    let firstPressStarted = () => {};
    const firstPressStartedPromise = new Promise<void>((resolve) => {
      firstPressStarted = resolve;
    });
    let secondFocusStarted = () => {};
    const secondFocusStartedPromise = new Promise<void>((resolve) => {
      secondFocusStarted = resolve;
    });
    fakePage.onFocus = async (selector) => {
      if (selector.includes('first.test.ts')) {
        firstFocusStarted();
        await firstFocus;
      } else {
        secondFocusStarted();
      }
    };
    fakePage.onPress = async (key) => {
      if (key === 'a') {
        firstPressStarted();
        await firstPress;
      }
    };

    const dispatch = (testPath: string, key: string) =>
      dispatchPlaywrightBrowserRpc({
        containerPage: fakePage as any,
        request: createRequest({
          testPath,
          kind: 'keyboard',
          method: 'press',
          args: [key],
        }),
        timeoutFallbackMs: 500,
      });
    const first = dispatch('/tests/first.test.ts', 'a');
    await firstFocusStartedPromise;
    const second = dispatch('/tests/second.test.ts', 'b');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakePage.keyboardEvents).toHaveLength(1);

    releaseFirstFocus();
    await firstPressStartedPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakePage.keyboardEvents).toEqual([
      expect.stringContaining(
        "focus:iframe[data-test-file='/tests/first.test.ts']",
      ),
      'press:start:a',
    ]);

    releaseFirstPress();
    await secondFocusStartedPromise;
    await Promise.all([first, second]);
    expect(fakePage.keyboardEvents).toEqual([
      expect.stringContaining(
        "focus:iframe[data-test-file='/tests/first.test.ts']",
      ),
      'press:start:a',
      'press:end:a',
      expect.stringContaining(
        "focus:iframe[data-test-file='/tests/second.test.ts']",
      ),
      'press:start:b',
      'press:end:b',
    ]);
  });

  it('serializes focus-changing locator actions with keyboard presses', async () => {
    const fakePage = new FakeContainerPage();
    const events: string[] = [];
    fakePage.frame.onAction = (method) => events.push(`action:${method}`);
    let releaseFirstPress = () => {};
    const firstPress = new Promise<void>((resolve) => {
      releaseFirstPress = resolve;
    });
    let firstPressStarted = () => {};
    const firstPressStartedPromise = new Promise<void>((resolve) => {
      firstPressStarted = resolve;
    });
    fakePage.onFocus = async () => {
      events.push('iframe:focus');
    };
    fakePage.onPress = async () => {
      events.push('press:start');
      firstPressStarted();
      await firstPress;
      events.push('press:end');
    };

    const keyboard = dispatchPlaywrightBrowserRpc({
      containerPage: fakePage as any,
      request: createRequest({
        kind: 'keyboard',
        method: 'press',
        args: ['a'],
      }),
      timeoutFallbackMs: 500,
    });
    await firstPressStartedPromise;
    const locatorFocus = dispatchPlaywrightBrowserRpc({
      containerPage: fakePage as any,
      request: createRequest({
        kind: 'locator',
        method: 'focus',
        locator: { steps: [{ type: 'locator', selector: '#input' }] },
      }),
      timeoutFallbackMs: 500,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(['iframe:focus', 'press:start']);

    releaseFirstPress();
    await Promise.all([keyboard, locatorFocus]);
    expect(events).toEqual([
      'iframe:focus',
      'press:start',
      'press:end',
      'action:focus',
    ]);
  });

  it('drops a queued keyboard press after its headed run expires', async () => {
    const fakePage = new FakeContainerPage();
    let releaseFirstPress = () => {};
    const firstPress = new Promise<void>((resolve) => {
      releaseFirstPress = resolve;
    });
    let firstPressStarted = () => {};
    const firstPressStartedPromise = new Promise<void>((resolve) => {
      firstPressStarted = resolve;
    });
    fakePage.onPress = async (key) => {
      if (key === 'a') {
        firstPressStarted();
        await firstPress;
      }
    };
    let secondRunCurrent = true;

    const first = dispatchPlaywrightBrowserRpc({
      containerPage: fakePage as any,
      request: createRequest({
        kind: 'keyboard',
        method: 'press',
        args: ['a'],
      }),
      timeoutFallbackMs: 500,
    });
    await firstPressStartedPromise;
    const second = dispatchPlaywrightBrowserRpc({
      containerPage: fakePage as any,
      request: createRequest({
        testPath: '/tests/next.test.ts',
        kind: 'keyboard',
        method: 'press',
        args: ['b'],
      }),
      isRequestCurrent: () => secondRunCurrent,
      timeoutFallbackMs: 500,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    secondRunCurrent = false;

    releaseFirstPress();
    await Promise.all([first, second]);
    expect(fakePage.keyboardCalls).toEqual([['a', undefined]]);
    expect(fakePage.focusChecks).toBe(1);
  });

  it('rejects unsupported keyboard methods and invalid keys', async () => {
    const fakePage = new FakePage(new FakeLocator());
    for (const [method, args, message] of [
      ['down', ['Shift'], 'Keyboard method not supported: down'],
      ['press', [''], 'keyboard.press expects a key'],
      ['press', [42], 'keyboard.press expects a key'],
    ] as const) {
      await expect(
        dispatchPlaywrightBrowserRpc({
          runnerPage: fakePage as any,
          request: createRequest({ kind: 'keyboard', method, args: [...args] }),
          timeoutFallbackMs: 500,
        }),
      ).rejects.toThrow(message);
    }
    expect(fakePage.keyboardCalls).toEqual([]);
  });

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

  it('compiles the drag target and forwards drag options', async () => {
    const fakeLocator = new FakeLocator();
    const options = { sourcePosition: { x: 4, y: 5 }, trial: true };
    const result = await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'locator',
        method: 'dragTo',
        args: [{ steps: [{ type: 'locator', selector: '#target' }] }, options],
      }),
      timeoutFallbackMs: 500,
    });
    expect(result).toBe('dragged');
    expect(fakeLocator.actionCalls).toContainEqual({
      method: 'dragTo',
      args: [fakeLocator, options],
    });
  });

  it('rejects unsupported locator actions', async () => {
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(new FakeLocator()) as any,
        request: createRequest({ kind: 'locator', method: 'tripleClick' }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Locator method not supported: tripleClick');
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
      signal: expect.any(AbortSignal),
    });
  });

  it('forwards accessibility assertions to Playwright', async () => {
    const fakeLocator = new FakeLocator();
    for (const [matcher, expectMethod, expected] of [
      ['toHaveRole', 'to.have.role', { type: 'string', value: 'button' }],
      [
        'toHaveAccessibleName',
        'to.have.accessible.name',
        { type: 'regexp', source: '^Save', flags: 'i' },
      ],
      [
        'toHaveAccessibleDescription',
        'to.have.accessible.description',
        { type: 'string', value: 'Stores changes' },
      ],
    ] as const) {
      await dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({
          kind: 'expect',
          method: matcher,
          args: [expected],
        }),
        timeoutFallbackMs: 900,
      });
      expect(fakeLocator.expectCalls.at(-1)?.method).toBe(expectMethod);
      expect(fakeLocator.expectCalls.at(-1)?.options).toMatchObject({
        isNot: false,
        expectedText: expect.any(Array),
      });
    }
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

  it('bounds failure screenshot capture by the request timeout', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'captureFailure',
        timeout: 25,
      }),
      timeoutFallbackMs: 500,
    });

    expect(fakeLocator.screenshotCalls).toHaveLength(1);
    expect(fakeLocator.screenshotCalls[0]?.timeout).toBeLessThanOrEqual(25);
    expect(fakeLocator.screenshotCalls[0]?.timeout).toBeGreaterThan(0);
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

  it('allows slow follow-up captures with the default stability timeout', async () => {
    const fakeLocator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(fakeLocator) as any,
      request: createRequest({
        kind: 'screenshot',
        method: 'toMatchScreenshot',
        timeout: 3000,
        args: ['button'],
      }),
      timeoutFallbackMs: 3000,
    });

    expect(fakeLocator.screenshotCalls).toHaveLength(2);
    expect(fakeLocator.screenshotCalls[1]?.timeout).toBeGreaterThan(500);
    expect(fakeLocator.screenshotCalls[1]?.timeout).toBeLessThanOrEqual(2000);
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
      signal: expect.any(AbortSignal),
    });
  });

  describe('when the condition is met between Playwright retries', () => {
    // Models Playwright's backoff at its coarsest: one check when the call
    // starts and one more at its deadline, unless the call is aborted.
    class LateCheckingLocator extends FakeLocator {
      readonly signals: AbortSignal[] = [];

      constructor(private readonly isMet: () => boolean) {
        super();
      }

      override async _expect(
        method: string,
        options: Record<string, unknown>,
      ): Promise<{ matches: boolean; log?: string[] }> {
        this.expectCalls.push({ method, options });
        const isSatisfied = () => this.isMet() !== (options.isNot === true);
        const check = () => ({
          matches: this.isMet(),
          log: [`Expect "${method}" with timeout ${options.timeout}ms`],
        });
        if (isSatisfied()) {
          return check();
        }
        const signal = options.signal as AbortSignal | undefined;
        if (signal) {
          this.signals.push(signal);
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.timeout as number);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        return check();
      }
    }

    const dispatchExpect = (
      locator: FakeLocator,
      overrides: Partial<BrowserRpcRequest>,
    ) =>
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(locator) as any,
        request: createRequest({ kind: 'expect', ...overrides }),
        timeoutFallbackMs: 5000,
      });

    it('resolves soon after the condition is met and aborts the pending check', async () => {
      const metAt = Date.now() + 150;
      const locator = new LateCheckingLocator(() => Date.now() >= metAt);

      await dispatchExpect(locator, { method: 'toBeVisible', timeout: 5000 });

      expect(Date.now() - metAt).toBeLessThan(1000);
      expect(locator.signals.length).toBeGreaterThan(0);
      expect(locator.signals.every((signal) => signal.aborted)).toBe(true);
    });

    it('resolves soon after a negated condition is met', async () => {
      const metAt = Date.now() + 150;
      const locator = new LateCheckingLocator(() => Date.now() < metAt);

      await dispatchExpect(locator, {
        method: 'toBeVisible',
        isNot: true,
        timeout: 5000,
      });

      expect(Date.now() - metAt).toBeLessThan(1000);
    });

    it('keeps the full-timeout failure report when the condition is never met', async () => {
      const locator = new LateCheckingLocator(() => false);

      await expect(
        dispatchExpect(locator, { method: 'toBeVisible', timeout: 300 }),
      ).rejects.toThrow('Expect "to.be.visible" with timeout 300ms');
    });
  });

  it('rejects unsupported expect matchers', async () => {
    const fakeLocator = new FakeLocator();
    await expect(
      dispatchPlaywrightBrowserRpc({
        runnerPage: new FakePage(fakeLocator) as any,
        request: createRequest({ kind: 'expect', method: 'toHaveFormValues' }),
        timeoutFallbackMs: 500,
      }),
    ).rejects.toThrow('Expect matcher not supported: toHaveFormValues');
  });

  it('forwards multi-select values, regex flags, negation, and timeout', async () => {
    const locator = new FakeLocator();
    await dispatchPlaywrightBrowserRpc({
      runnerPage: new FakePage(locator) as any,
      request: createRequest({
        kind: 'expect',
        method: 'toHaveValues',
        args: [
          [
            { type: 'string', value: 'typescript' },
            { type: 'regexp', source: '^RUST$', flags: 'i' },
          ],
        ],
        isNot: true,
        timeout: 25,
      }),
      timeoutFallbackMs: 500,
    });
    expect(locator.expectCalls).toMatchObject([
      {
        method: 'to.have.values',
        options: {
          isNot: true,
          timeout: 25,
          expectedText: [
            { string: 'typescript' },
            {
              regexSource: '^RUST$',
              regexFlags: 'i',
            },
          ],
        },
      },
    ]);
  });

  it('rejects malformed multi-select value arguments at the RPC boundary', async () => {
    const locator = new FakeLocator();
    for (const values of ['typescript', [123]]) {
      await expect(
        dispatchPlaywrightBrowserRpc({
          runnerPage: new FakePage(locator) as any,
          request: createRequest({
            kind: 'expect',
            method: 'toHaveValues',
            args: [values],
          }),
          timeoutFallbackMs: 500,
        }),
      ).rejects.toThrow(/toHaveValues expects/);
    }
    expect(locator.expectCalls).toHaveLength(0);
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
