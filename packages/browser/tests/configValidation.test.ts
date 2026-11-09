import { describe, expect, it } from '@rstest/core';
import { browserIgnoredRuntimeConfigKeys } from '@rstest/core/internal/browser';
import type {
  InternalContext,
  InternalProjectContext,
} from '@rstest/core/internal/browser';
import {
  browserValidatedIgnoredKeys,
  validateBrowserConfig,
} from '../src/configValidation';

describe('browser config validation lockstep', () => {
  it('checks every browser-ignored RuntimeConfig key from the capability table', () => {
    // Anti-#1389: a new 'ignored-warn' / 'stripped' row in executorCapabilities
    // without a matching check in configValidation would be a silent browser
    // no-op. Importing configValidation also runs its module-load assertion.
    for (const key of browserIgnoredRuntimeConfigKeys) {
      expect(browserValidatedIgnoredKeys).toContain(key);
    }
  });
});

describe('browser config validation errors', () => {
  const makeProject = (
    name: string,
    browser: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ): InternalProjectContext =>
    ({
      name,
      normalizedConfig: {
        isolate: true,
        setupFiles: [],
        testEnvironment: { name: 'node' },
        detectAsyncLeaks: false,
        logHeapUsage: false,
        browser: {
          enabled: false,
          provider: 'playwright',
          headless: true,
          screenshotFailures: false,
          strictPort: false,
          providerOptions: {},
          browsers: [
            {
              browserName: 'chromium',
              headless: true,
              screenshotFailures: false,
              providerOptions: {},
            },
          ],
          ...browser,
        },
        ...extra,
      },
    }) as unknown as InternalProjectContext;

  const makeContext = (
    projects: InternalProjectContext[],
    coverage?: Record<string, unknown>,
  ): InternalContext =>
    ({
      command: 'run',
      projects,
      normalizedConfig: {
        coverage: coverage ?? { enabled: false },
        pool: { type: 'forks' },
      },
    }) as unknown as InternalContext;

  it('accepts a run selecting several headless browsers in one project', () => {
    const context = makeContext([
      makeProject('p', {
        enabled: true,
        browsers: [
          {
            browserName: 'chromium',
            headless: true,
            screenshotFailures: false,
            providerOptions: {},
          },
          {
            browserName: 'firefox',
            headless: true,
            screenshotFailures: false,
            providerOptions: {},
          },
        ],
      }),
    ]);
    expect(() => validateBrowserConfig(context)).not.toThrow();
  });

  it('rejects watch mixed with a headed pair when headless rows exist too', () => {
    const watchContext = (
      command: string,
      projects: InternalProjectContext[],
    ): InternalContext =>
      ({
        command,
        projects,
        normalizedConfig: {
          coverage: { enabled: false },
          pool: { type: 'forks' },
        },
      }) as unknown as InternalContext;

    const hybrid = [
      makeProject('p', {
        enabled: true,
        browsers: [
          {
            browserName: 'chromium',
            headless: false,
            screenshotFailures: false,
            providerOptions: {},
          },
          {
            browserName: 'firefox',
            headless: true,
            screenshotFailures: false,
            providerOptions: {},
          },
        ],
      }),
    ];
    expect(() => validateBrowserConfig(watchContext('watch', hybrid))).toThrow(
      /Watch mode does not support mixing headed/,
    );
    expect(() =>
      validateBrowserConfig(watchContext('run', hybrid)),
    ).not.toThrow();

    // Watch + single headless-only selection stays valid.
    const headlessOnly = [
      makeProject('p', {
        enabled: true,
        browsers: [
          {
            browserName: 'chromium',
            headless: true,
            screenshotFailures: false,
            providerOptions: {},
          },
          {
            browserName: 'firefox',
            headless: true,
            screenshotFailures: false,
            providerOptions: {},
          },
        ],
      }),
    ];
    expect(() =>
      validateBrowserConfig(watchContext('watch', headlessOnly)),
    ).not.toThrow();
  });

  it('rejects more than one headed (project, browser) pair per run', () => {
    const context = makeContext([
      makeProject('a', {
        enabled: true,
        browsers: [
          {
            browserName: 'chromium',
            headless: false,
            screenshotFailures: false,
            providerOptions: {},
          },
        ],
      }),
      makeProject('b', {
        enabled: true,
        browsers: [
          {
            browserName: 'firefox',
            headless: false,
            screenshotFailures: false,
            providerOptions: {},
          },
        ],
      }),
    ]);
    expect(() => validateBrowserConfig(context)).toThrow(
      /Only one \(project, browser\) pair can run headed/,
    );
  });

  it('hard-errors v8 coverage for a selected non-Chromium browser, in browser-only and mixed runs', () => {
    const v8Coverage = {
      enabled: true,
      provider: 'v8',
    };
    const browserOnly = makeContext(
      [
        makeProject('p', {
          enabled: true,
          browsers: [
            {
              browserName: 'firefox',
              headless: true,
              screenshotFailures: false,
              providerOptions: {},
            },
          ],
        }),
      ],
      v8Coverage,
    );
    expect(() => validateBrowserConfig(browserOnly)).toThrow(
      /Coverage provider 'v8' in browser mode requires Chromium[\s\S]*Switch to coverage\.provider: 'istanbul'|select Chromium only/,
    );

    const mixed = makeContext(
      [
        makeProject('p', {
          enabled: true,
          browsers: [
            {
              browserName: 'firefox',
              headless: true,
              screenshotFailures: false,
              providerOptions: {},
            },
          ],
        }),
        makeProject('node', { enabled: false }),
      ],
      v8Coverage,
    );
    expect(() => validateBrowserConfig(mixed)).toThrow(
      /Coverage provider 'v8' in browser mode requires Chromium/,
    );
  });

  it('passes a mixed run where every selected browser is chromium', () => {
    const context = makeContext([
      makeProject('p', { enabled: true }),
      makeProject('node', { enabled: false }),
    ]);
    expect(() => validateBrowserConfig(context)).not.toThrow();
  });
});
