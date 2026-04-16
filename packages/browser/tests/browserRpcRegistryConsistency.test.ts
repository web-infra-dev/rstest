import { describe, expect, it } from '@rstest/core';
import type { BrowserElementExpect } from '../src/augmentExpect';
import {
  supportedExpectElementMatchers,
  supportedLocatorActions,
} from '../src/browserRpcRegistry';
import { Locator } from '../src/client/locator';
import type { BrowserRpcRequest } from '../src/protocol';
import { dispatchPlaywrightBrowserRpc } from '../src/providers/playwright/dispatchBrowserRpc';

class FakeLocator {
  actionCalls: Array<{ method: string; args: unknown[] }> = [];
  expectCalls: Array<{ method: string; options: Record<string, unknown> }> = [];

  constructor() {
    for (const method of supportedLocatorActions) {
      (this as Record<string, unknown>)[method] = async (
        ...args: unknown[]
      ) => {
        this.actionCalls.push({ method, args });
        return null;
      };
    }
  }

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

const createSerializedText = (value: string) => ({
  type: 'string' as const,
  value,
});

const createExpectArgs = (method: string): unknown[] => {
  switch (method) {
    case 'toHaveText':
    case 'toContainText':
    case 'toHaveValue':
    case 'toHaveId':
    case 'toHaveClass':
      return [createSerializedText('expected')];
    case 'toBeInViewport':
      return [0.5];
    case 'toHaveCount':
      return [1];
    case 'toHaveAttribute':
      return ['data-testid', createSerializedText('submit')];
    case 'toHaveCSS':
      return ['color', createSerializedText('red')];
    case 'toHaveJSProperty':
      return ['checked', true];
    default:
      return [];
  }
};

describe('browser RPC registry consistency', () => {
  it('keeps locator action registry aligned with Locator class methods', () => {
    for (const method of supportedLocatorActions) {
      expect(typeof (Locator.prototype as any)[method]).toBe('function');
    }
  });

  it('keeps expect matcher registry aligned with BrowserElementExpect type surface', () => {
    const expectApiShape: Omit<BrowserElementExpect, 'not'> = {
      async toBeVisible() {},
      async toBeHidden() {},
      async toBeEnabled() {},
      async toBeDisabled() {},
      async toBeChecked() {},
      async toBeUnchecked() {},
      async toBeAttached() {},
      async toBeDetached() {},
      async toBeEditable() {},
      async toBeFocused() {},
      async toBeEmpty() {},
      async toBeInViewport() {},
      async toHaveText() {},
      async toContainText() {},
      async toHaveValue() {},
      async toHaveId() {},
      async toHaveAttribute() {},
      async toHaveClass() {},
      async toHaveCount() {},
      async toHaveCSS() {},
      async toHaveJSProperty() {},
    };

    const typeMethods = new Set(Object.keys(expectApiShape));

    expect(new Set(supportedExpectElementMatchers)).toEqual(typeMethods);
  });

  it('dispatches every allowlisted locator action without unsupported errors', async () => {
    for (const method of supportedLocatorActions) {
      const fakeLocator = new FakeLocator();
      await expect(
        dispatchPlaywrightBrowserRpc({
          runnerPage: new FakePage(fakeLocator) as any,
          request: createRequest({ kind: 'locator', method, args: [] }),
          timeoutFallbackMs: 500,
        }),
      ).resolves.toBeNull();
    }
  });

  it('dispatches every allowlisted expect matcher without unhandled errors', async () => {
    for (const method of supportedExpectElementMatchers) {
      const fakeLocator = new FakeLocator();
      await expect(
        dispatchPlaywrightBrowserRpc({
          runnerPage: new FakePage(fakeLocator) as any,
          request: createRequest({
            kind: 'expect',
            method,
            args: createExpectArgs(method),
          }),
          timeoutFallbackMs: 800,
        }),
      ).resolves.toBeNull();
    }
  });
});
