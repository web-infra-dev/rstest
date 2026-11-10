import { describe, expect, it, rs } from '@rstest/core';
import {
  type InternalProjectContext,
  logger,
} from '@rstest/core/internal/browser';
import { resolveProjectBrowsers } from '../src/browserEntries';

const makeProject = (
  browser: Record<string, unknown> = {},
): InternalProjectContext =>
  ({
    name: 'p',
    normalizedConfig: {
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        screenshotFailures: true,
        strictPort: false,
        providerOptions: {},
        ...browser,
      },
    },
  }) as unknown as InternalProjectContext;

describe('resolveProjectBrowsers', () => {
  it('resolves the default single chromium entry with project defaults merged', () => {
    expect(resolveProjectBrowsers(makeProject())).toEqual([
      {
        browserName: 'chromium',
        headless: true,
        screenshotFailures: true,
        providerOptions: {},
      },
    ]);
  });

  it('expands a browser-name list into one plain entry per browser', () => {
    expect(
      resolveProjectBrowsers(
        makeProject({
          headless: false,
          screenshotFailures: false,
          viewport: 'iPhone12Pro',
          browsers: ['chromium', 'firefox'],
        }),
      ),
    ).toEqual([
      {
        browserName: 'chromium',
        headless: false,
        screenshotFailures: false,
        viewport: 'iPhone12Pro',
        providerOptions: {},
      },
      {
        browserName: 'firefox',
        headless: false,
        screenshotFailures: false,
        viewport: 'iPhone12Pro',
        providerOptions: {},
      },
    ]);
  });

  it('merges per-entry overrides over the project-level defaults per providerOptions key', () => {
    const entries = resolveProjectBrowsers(
      makeProject({
        viewport: 'iPhone12Pro',
        providerOptions: {
          launch: { channel: 'chromium', args: ['--no-sandbox'] },
          context: { locale: 'en-US' },
        },
        browsers: [
          'chromium',
          { browserName: 'firefox', headless: false, viewport: 'GalaxyZFold5' },
          {
            browserName: 'webkit',
            providerOptions: { launch: { channel: 'webkit-nightly' } },
          },
        ],
      }),
    );

    expect(entries).toMatchObject([
      { browserName: 'chromium', headless: true, viewport: 'iPhone12Pro' },
      {
        browserName: 'firefox',
        headless: false,
        viewport: 'GalaxyZFold5',
        providerOptions: {
          launch: { channel: 'chromium', args: ['--no-sandbox'] },
          context: { locale: 'en-US' },
        },
      },
      {
        browserName: 'webkit',
        headless: true,
        viewport: 'iPhone12Pro',
        // Entry providerOptions replace per top-level key: `launch` replaced
        // wholesale, sibling `context` kept.
        providerOptions: {
          launch: { channel: 'webkit-nightly' },
          context: { locale: 'en-US' },
        },
      },
    ]);
  });

  it('resolves the deprecated browser.browser into a single entry and warns once', () => {
    const warn = rs.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      expect(
        resolveProjectBrowsers(makeProject({ browser: 'firefox' })),
      ).toMatchObject([{ browserName: 'firefox', providerOptions: {} }]);
      resolveProjectBrowsers(makeProject({ browser: 'webkit' }));
      const deprecation = warn.mock.calls.filter(([message]) =>
        String(message).includes('`browser.browser` is deprecated'),
      );
      // Once per process, not once per project.
      expect(deprecation.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('returns the same resolution for repeated calls on one project', () => {
    const project = makeProject({ browsers: ['chromium', 'firefox'] });
    expect(resolveProjectBrowsers(project)).toBe(
      resolveProjectBrowsers(project),
    );
  });

  it('rejects setting browser.browser together with browser.browsers', () => {
    expect(() =>
      resolveProjectBrowsers(
        makeProject({ browser: 'chromium', browsers: ['firefox'] }),
      ),
    ).toThrow(/cannot be set together/);
  });

  it('rejects an empty browsers list', () => {
    expect(() => resolveProjectBrowsers(makeProject({ browsers: [] }))).toThrow(
      /must not be empty/,
    );
  });

  it('rejects duplicate browser names within one project', () => {
    expect(() =>
      resolveProjectBrowsers(
        makeProject({ browsers: ['chromium', { browserName: 'chromium' }] }),
      ),
    ).toThrow(/appears twice/);
  });

  it('rejects unknown browser names in config', () => {
    expect(() =>
      resolveProjectBrowsers(makeProject({ browsers: ['safari'] })),
    ).toThrow(/must either be a browser name/);
    expect(() =>
      resolveProjectBrowsers(
        makeProject({ browsers: [{ browserName: 'macOS' }] }),
      ),
    ).toThrow(/must either be a browser name/);
  });

  describe('CLI selection', () => {
    it('keeps the configured entry (with overrides) of a selected browser', () => {
      expect(
        resolveProjectBrowsers(
          makeProject({
            browsers: ['chromium', { browserName: 'firefox', headless: false }],
            cliBrowsers: ['firefox'],
          }),
        ),
      ).toMatchObject([{ browserName: 'firefox', headless: false }]);
    });

    it('falls back to a plain entry for a selected browser without a configured entry', () => {
      expect(
        resolveProjectBrowsers(
          makeProject({
            browsers: ['chromium'],
            cliBrowsers: ['chromium', 'firefox'],
          }),
        ).map((entry) => entry.browserName),
      ).toEqual(['chromium', 'firefox']);
    });

    it('absorbs the deprecated browser.browser instead of reporting a conflict', () => {
      expect(
        resolveProjectBrowsers(
          makeProject({ browser: 'chromium', cliBrowsers: ['webkit'] }),
        ).map((entry) => entry.browserName),
      ).toEqual(['webkit']);
    });

    it('rejects unknown names', () => {
      expect(() =>
        resolveProjectBrowsers(makeProject({ cliBrowsers: ['safari'] })),
      ).toThrow(/Unknown browser value "safari"/);
    });

    it('rejects a duplicated selection', () => {
      expect(() =>
        resolveProjectBrowsers(
          makeProject({ cliBrowsers: ['chromium', 'chromium'] }),
        ),
      ).toThrow(/appears twice/);
    });
  });
});
