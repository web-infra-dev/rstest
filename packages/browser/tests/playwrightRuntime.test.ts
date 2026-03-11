import { afterEach, describe, expect, it } from '@rstest/core';
import { chromium } from 'playwright';
import { launchPlaywrightBrowser } from '../src/providers/playwright/runtime';

type FakeContext = {
  newPage: () => Promise<never>;
  on: () => void;
  close: () => Promise<void>;
  setDefaultTimeout: (...args: unknown[]) => void;
  setDefaultNavigationTimeout: (...args: unknown[]) => void;
};

describe('launchPlaywrightBrowser', () => {
  const originalChromiumLaunch = chromium.launch;

  afterEach(() => {
    chromium.launch = originalChromiumLaunch;
  });

  it('passes through launch and context options without timeout translation', async () => {
    const launchCalls: Array<Record<string, unknown>> = [];
    const contextCalls: Array<Record<string, unknown>> = [];
    const defaultTimeoutCalls: unknown[][] = [];
    const defaultNavigationTimeoutCalls: unknown[][] = [];

    const fakeContext: FakeContext = {
      async newPage() {
        throw new Error('unused in this test');
      },
      on() {},
      async close() {},
      setDefaultTimeout(...args: unknown[]) {
        defaultTimeoutCalls.push(args);
      },
      setDefaultNavigationTimeout(...args: unknown[]) {
        defaultNavigationTimeoutCalls.push(args);
      },
    };

    chromium.launch = (async (options?: Record<string, unknown>) => {
      launchCalls.push(options ?? {});

      return {
        async close() {},
        async newContext(contextOptions?: Record<string, unknown>) {
          contextCalls.push(contextOptions ?? {});
          return fakeContext as never;
        },
      } as never;
    }) as typeof chromium.launch;

    const runtime = await launchPlaywrightBrowser({
      browserName: 'chromium',
      headless: true,
      providerOptions: {
        launch: {
          channel: 'chrome',
          timeout: 1234,
        },
      },
    });

    await runtime.browser.newContext({
      providerOptions: {
        context: {
          colorScheme: 'dark',
          locale: 'en-US',
        },
        actionTimeout: 5000,
        navigationTimeout: 6000,
      },
      viewport: { width: 1280, height: 720 },
    });

    expect(launchCalls).toEqual([
      {
        channel: 'chrome',
        timeout: 1234,
        headless: true,
        args: [
          '--disable-popup-blocking',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      },
    ]);

    expect(contextCalls).toEqual([
      {
        colorScheme: 'dark',
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
      },
    ]);
    expect(defaultTimeoutCalls).toEqual([]);
    expect(defaultNavigationTimeoutCalls).toEqual([]);
  });

  it('prefers user-provided launch args over Chromium defaults', async () => {
    const launchCalls: Array<Record<string, unknown>> = [];

    chromium.launch = (async (options?: Record<string, unknown>) => {
      launchCalls.push(options ?? {});

      return {
        async close() {},
        async newContext() {
          throw new Error('unused in this test');
        },
      } as never;
    }) as typeof chromium.launch;

    await launchPlaywrightBrowser({
      browserName: 'chromium',
      headless: true,
      providerOptions: {
        launch: {
          args: ['--user-defined-arg'],
        },
      },
    });

    expect(launchCalls).toEqual([
      {
        args: ['--user-defined-arg'],
        headless: true,
      },
    ]);
  });
});
