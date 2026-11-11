import { describe, expect, it, rs } from '@rstest/core';
import {
  resolveBrowserInstances,
  selectCliInstanceProjects,
} from '../../src/core/browser/browserInstances';
import type { InternalProjectContext } from '../../src/types';
import { logger } from '../../src/utils/logger';

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

describe('resolveBrowserInstances', () => {
  it('resolves the default single chromium instance with project defaults merged', () => {
    expect(resolveBrowserInstances(makeProject())).toEqual([
      {
        name: 'p',
        browserName: 'chromium',
        headless: true,
        screenshotFailures: true,
        providerOptions: {},
      },
    ]);
  });

  it('expands an instance list into one plain instance per browser', () => {
    expect(
      resolveBrowserInstances(
        makeProject({
          headless: false,
          screenshotFailures: false,
          viewport: 'iPhone12Pro',
          instances: [{ browserName: 'chromium' }, { browserName: 'firefox' }],
        }),
      ),
    ).toEqual([
      {
        name: 'p (chromium)',
        browserName: 'chromium',
        headless: false,
        screenshotFailures: false,
        viewport: 'iPhone12Pro',
        providerOptions: {},
      },
      {
        name: 'p (firefox)',
        browserName: 'firefox',
        headless: false,
        screenshotFailures: false,
        viewport: 'iPhone12Pro',
        providerOptions: {},
      },
    ]);
  });

  it('merges per-entry overrides over the project-level defaults per providerOptions key', () => {
    const entries = resolveBrowserInstances(
      makeProject({
        viewport: 'iPhone12Pro',
        providerOptions: {
          launch: { channel: 'chromium', args: ['--no-sandbox'] },
          context: { locale: 'en-US' },
        },
        instances: [
          { browserName: 'chromium' },
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
        resolveBrowserInstances(makeProject({ browser: 'firefox' })),
      ).toMatchObject([{ browserName: 'firefox', providerOptions: {} }]);
      resolveBrowserInstances(makeProject({ browser: 'webkit' }));
      const deprecation = warn.mock.calls.filter(([message]) =>
        String(message).includes('`browser.browser` is deprecated'),
      );
      // Once per process, not once per project.
      expect(deprecation.length).toBeLessThanOrEqual(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('rejects setting browser.browser together with browser.instances', () => {
    expect(() =>
      resolveBrowserInstances(
        makeProject({
          browser: 'chromium',
          instances: [{ browserName: 'firefox' }],
        }),
      ),
    ).toThrow(/cannot be set together/);
  });

  it('rejects an empty instances list', () => {
    expect(() =>
      resolveBrowserInstances(makeProject({ instances: [] })),
    ).toThrow(/must not be empty/);
  });

  it('rejects duplicate browser names within one project', () => {
    expect(() =>
      resolveBrowserInstances(
        makeProject({
          instances: [{ browserName: 'chromium' }, { browserName: 'chromium' }],
        }),
      ),
    ).toThrow(/appears twice/);
  });

  it('rejects unknown browser names in config', () => {
    expect(() =>
      resolveBrowserInstances(
        makeProject({ instances: [{ browserName: 'macOS' }] }),
      ),
    ).toThrow(/must be an object with a `browserName` field/);
  });

  it('rejects a string item and shows the object form', () => {
    expect(() =>
      resolveBrowserInstances(makeProject({ instances: ['chromium'] })),
    ).toThrow(/Use `\{ browserName: "chromium" \}`/);
  });

  it('rejects a non-array instances value', () => {
    expect(() =>
      resolveBrowserInstances(makeProject({ instances: 'chromium' })),
    ).toThrow(/must be an array of objects/);
  });

  describe('CLI selection', () => {
    const configured = [
      { browserName: 'chromium' },
      { browserName: 'firefox', headless: false },
    ];

    it('keeps the configured instance (with overrides) of a selected browser', () => {
      expect(
        resolveBrowserInstances(
          makeProject({ instances: configured, cliInstances: ['firefox'] }),
        ),
      ).toMatchObject([{ name: 'p', browserName: 'firefox', headless: false }]);
    });

    it('never creates an instance from a name: unmatched names select nothing', () => {
      expect(
        resolveBrowserInstances(
          makeProject({
            instances: [{ browserName: 'chromium' }],
            cliInstances: ['firefox'],
          }),
        ),
      ).toEqual([]);
    });

    it('selects the default chromium instance when nothing is configured', () => {
      expect(
        resolveBrowserInstances(
          makeProject({ cliInstances: ['chromium'] }),
        ).map((instance) => instance.browserName),
      ).toEqual(['chromium']);
    });

    it('selects the instance of the deprecated browser.browser', () => {
      expect(
        resolveBrowserInstances(
          makeProject({ browser: 'webkit', cliInstances: ['webkit'] }),
        ).map((instance) => instance.browserName),
      ).toEqual(['webkit']);
      expect(
        resolveBrowserInstances(
          makeProject({ browser: 'webkit', cliInstances: ['chromium'] }),
        ),
      ).toEqual([]);
    });

    it('rejects unknown names', () => {
      expect(() =>
        resolveBrowserInstances(makeProject({ cliInstances: ['safari'] })),
      ).toThrow(/Unknown browser value "safari"/);
    });

    it('rejects a duplicated selection', () => {
      expect(() =>
        resolveBrowserInstances(
          makeProject({ cliInstances: ['chromium', 'chromium'] }),
        ),
      ).toThrow(/appears twice/);
    });
  });

  describe('deprecated --browser.name', () => {
    it('runs the configured instance with its overrides', () => {
      expect(
        resolveBrowserInstances(
          makeProject({
            instances: [
              { browserName: 'chromium' },
              { browserName: 'firefox', headless: false },
            ],
            cliBrowserName: 'firefox',
          }),
        ),
      ).toMatchObject([{ name: 'p', browserName: 'firefox', headless: false }]);
    });

    it('falls back to a plain instance with project defaults', () => {
      expect(
        resolveBrowserInstances(
          makeProject({
            instances: [{ browserName: 'chromium', headless: false }],
            cliBrowserName: 'webkit',
          }),
        ),
      ).toMatchObject([{ browserName: 'webkit', headless: true }]);
    });
  });
});

describe('selectCliInstanceProjects', () => {
  const named = (name: string, browser: Record<string, unknown> = {}) => ({
    ...makeProject(browser),
    name,
  });
  const nodeProject = {
    name: 'node',
    normalizedConfig: { browser: { enabled: false } },
  } as unknown as InternalProjectContext;

  it('returns the projects untouched without a CLI selection', () => {
    const projects = [named('a'), nodeProject];
    expect(selectCliInstanceProjects(projects)).toBe(projects);
  });

  it('skips a browser project with no matching instance and keeps node projects', () => {
    const web = named('web', {
      instances: [{ browserName: 'chromium' }, { browserName: 'webkit' }],
      cliInstances: ['webkit'],
    });
    const other = named('other', {
      instances: [{ browserName: 'chromium' }],
      cliInstances: ['webkit'],
    });
    expect(selectCliInstanceProjects([web, other, nodeProject])).toEqual([
      web,
      nodeProject,
    ]);
  });

  it('errors on a name no browser project configures, naming the configured browsers', () => {
    const web = named('web', {
      instances: [{ browserName: 'chromium' }, { browserName: 'webkit' }],
      cliInstances: ['firefox'],
    });
    expect(() => selectCliInstanceProjects([web])).toThrow(
      /Browser "firefox" from `--browser\.instances` is not configured by any selected browser project\. Configured browsers per project: "web": chromium, webkit\./,
    );
  });
});
