import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeEach, expect, test } from '../src';
import { getDebugOptions, resolveLaunchOptions } from '../src/fixture';
import type { Browser, BrowserContext, Page } from 'playwright';
import type {
  PlaywrightFixtures,
  PlaywrightOptions,
  PlaywrightTest,
  PlaywrightUse,
} from '../src';

const debugOptions = {
  debug: {
    enabled: true,
    slowMo: 25,
    devtools: false,
  },
} satisfies PlaywrightOptions;

const execFileAsync = promisify(execFile);

const ciPlaywrightOptions = {
  browserName: 'chromium',
  // These package tests use the CI-provided Chrome binary to avoid installing
  // Playwright Chromium. This does not change @rstest/playwright defaults.
  launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
} satisfies PlaywrightOptions;

const browserTest = test.extend({
  playwright: ciPlaywrightOptions,
});

let sharedBrowser: Browser | undefined;

const createPage = (title: string) =>
  ({
    goto: async () => null,
    locator: () => null,
    title: async () => title,
  }) as unknown as Page;

test('provides an isolated request fixture', async ({ request }) => {
  expect(request).toBeTruthy();
});

test('can be imported outside a rstest worker', async () => {
  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { test } from './packages/playwright/dist/index.js'; console.log(typeof test, typeof test.extend);",
    ],
    { cwd: join(__dirname, '../../..') },
  );
});

test('exposes playwright options fixture overrides', async ({ playwright }) => {
  expect(playwright.browserName).toBe('chromium');
});

test.sequential(
  'allows local mutation of default playwright options',
  ({ playwright }) => {
    playwright.launchOptions = { headless: false };

    expect(playwright.launchOptions).toEqual({ headless: false });
  },
);

test.sequential(
  'provides fresh default playwright options',
  ({ playwright }) => {
    expect(playwright.launchOptions).toBeUndefined();
  },
);

browserTest.sequential('stores the shared browser', ({ browser }) => {
  sharedBrowser = browser;
});

browserTest.sequential('reuses the shared browser', ({ browser }) => {
  expect(browser).toBe(sharedBrowser);
});

browserTest.extend({
  playwright: {
    ...ciPlaywrightOptions,
    contextOptions: {
      viewport: {
        width: 390,
        height: 844,
      },
    },
  } satisfies PlaywrightOptions,
})('applies context options', async ({ page }) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
});

browserTest.extend({
  customFixture: async ({ page }, use) => {
    await use(`viewport-${page.viewportSize()?.width ?? 0}`);
  },
})('preserves extended fixture types', async ({ customFixture }) => {
  expect(customFixture).toContain('viewport');
});

browserTest
  .extend({
    customFixture: async ({ page }, use) => {
      await use(`viewport-${page.viewportSize()?.width ?? 0}`);
    },
  })
  .concurrent(
    'keeps the shared browser alive for concurrent tests',
    async ({ customFixture }) => {
      expect(customFixture).toContain('viewport');
    },
  );

browserTest.extend<{ createLabel: () => Promise<string> }>({
  createLabel: async ({ page }, use) => {
    await use(async () => `viewport-${page.viewportSize()?.width ?? 0}`);
  },
})('preserves function-valued fixture types', async ({ createLabel }) => {
  await expect(createLabel()).resolves.toContain('viewport');
});

type Agent = {
  page: Page;
};

const createAgentTest = (baseTest: PlaywrightTest) =>
  baseTest.extend<{ agent: Agent }>({
    agent: async ({ page }, use) => {
      await use({ page });
    },
  });

const agentTest = createAgentTest(browserTest);

agentTest('supports third-party fixture wrappers', async ({ agent, page }) => {
  expect(agent.page).toBe(page);
});

test.extend({
  playwright: async (_, use) => {
    await use({
      browserName: 'chromium',
      launchOptions: {
        headless: true,
      },
    });
  },
})('allows overriding the playwright fixture', async ({ playwright }) => {
  expect(playwright.launchOptions).toEqual({ headless: true });
});

browserTest.extend<{ url: string }>({
  url: 'about:blank',
  page: async ({ context, url }, use) => {
    const page = await context.newPage();
    await page.goto(url);

    try {
      await use(page);
    } finally {
      await page.close();
    }
  },
})('allows overriding the page fixture', async ({ page, url }) => {
  expect(page.url()).toBe(url);
});

const thirdPartyFixtures = {
  customContext: async ({ browser }, use) => {
    const context = await browser.newContext();

    try {
      await use(context);
    } finally {
      await context.close();
    }
  },
} satisfies PlaywrightFixtures<
  { customContext: BrowserContext },
  { playwright: PlaywrightOptions }
>;

browserTest.extend(thirdPartyFixtures)(
  'exposes fixture and use types for third-party packages',
  async ({ customContext }) => {
    expect(customContext.pages()).toEqual([]);
  },
);

const customUse: PlaywrightUse<string> = async (value) => {
  expect(value).toBe('ok');
};

test('exposes the fixture use type', async () => {
  await customUse('ok');
});

test.extend({
  playwright: debugOptions,
})('accepts headed debug options', async ({ playwright }) => {
  expect(playwright.debug).toEqual(debugOptions.debug);
});

test('enables headed debug mode from PWDEBUG', () => {
  const original = process.env.PWDEBUG;
  process.env.PWDEBUG = '1';

  try {
    expect(getDebugOptions(undefined)).toEqual({});
    expect(resolveLaunchOptions({})).toEqual({
      headless: false,
      slowMo: 100,
      devtools: true,
    });
  } finally {
    if (original === undefined) {
      delete process.env.PWDEBUG;
    } else {
      process.env.PWDEBUG = original;
    }
  }
});

test.extend({}).describe('extended test API', () => {
  const hookExpectTest = test.extend<{ hookTitle: string }>({
    hookTitle: 'hook title',
  });

  hookExpectTest.describe('wrapped hooks', () => {
    hookExpectTest.beforeEach(async () => {
      expect.assertions(2);
      expect('hook title').toBe('hook title');
      await expect(createPage('hook title')).toHaveTitle('hook title');
    });

    hookExpectTest('counts Playwright assertions in extended hooks', () => {});
  });

  test.extend({}).beforeEach(() => {});

  test.extend({}).for<{ value: string }>`
    value
    ${'ok'}
  `('preserves tagged-template test.for types', ({ value }) => {
    expect(value).toBe('ok');
  });

  test.extend({}).concurrent.each(['each title'])(
    'counts Playwright assertions in test.each callbacks',
    async (title) => {
      expect.assertions(1);
      await expect(createPage(title)).toHaveTitle(title);
    },
  );

  test.extend({}).each([[1, 2]])(
    'does not expose test.each context to user callbacks',
    (...args) => {
      expect(args).toEqual([1, 2]);
    },
  );

  test.extend({
    fixtureTitle: async ({ expect: localExpect }, use) => {
      localExpect.assertions(1);
      await expect(createPage('fixture title')).toHaveTitle('fixture title');
      await use('fixture title');
    },
  })(
    'counts Playwright assertions in extended fixtures',
    ({ fixtureTitle }) => {
      void fixtureTitle;
    },
  );

  browserTest.for([{ path: 'about:blank' }])(
    'detects fixtures from test.for callback context',
    async ({ path }, { page }) => {
      await page.goto(path);

      expect(page.url()).toBe(path);
    },
  );

  test.extend({})('preserves playwright-style helpers', () => {
    const extendedTest = test.extend({});

    expect(typeof extendedTest.fail).toBe('function');
    expect(typeof extendedTest.describe).toBe('function');
    expect(typeof extendedTest.beforeAll).toBe('function');
    expect(typeof extendedTest.afterAll).toBe('function');
    expect(typeof extendedTest.beforeEach).toBe('function');
    expect(typeof extendedTest.afterEach).toBe('function');
  });
});

test.describe('imported hooks', () => {
  beforeEach(async ({ expect: localExpect }) => {
    localExpect.assertions(1);
    await expect(createPage('imported hook')).toHaveTitle('imported hook');
  });

  test('counts Playwright assertions in imported hooks', () => {});
});

test(
  'starts a static server from the serve fixture',
  { timeout: 30_000 },
  async ({ request, serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const { url } = await serve(join(root, 'index.html'));
    const response = await request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe('<h1>ok</h1>');
  },
);

test(
  'resolves relative static server entries from the current test file',
  { timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    const fixtureDir = join(root, 'fixture');
    await mkdir(join(fixtureDir, 'dist'), { recursive: true });
    await writeFile(join(fixtureDir, 'dist/index.html'), '<h1>relative</h1>');

    const fixturePath = join(fixtureDir, 'relative.test.mjs');
    await writeFile(
      fixturePath,
      `
        import { test, expect } from ${JSON.stringify(join(__dirname, '../dist/index.js').replaceAll('\\', '/'))};

        test('serves a file relative to this test file', async ({ request, serve }) => {
          const { url } = await serve('./dist/index.html');
          const response = await request.get(url);

          expect(await response.text()).toBe('<h1>relative</h1>');
        });
      `,
    );

    const rootDir = join(__dirname, '../../..');
    await execFileAsync(
      process.execPath,
      [
        join(rootDir, 'packages/core/bin/rstest.js'),
        '--root',
        root,
        '--include',
        './fixture/relative.test.mjs',
      ],
      { cwd: rootDir },
    );
  },
);

test(
  'formats IPv6 static server hosts as valid URLs',
  { timeout: 30_000 },
  async ({ serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const { url } = await serve(join(root, 'index.html'), { host: '::1' });

    expect(url).toMatch(/^http:\/\/\[::1\]:\d+$/);
  },
);

test(
  'returns 404 for malformed static server paths',
  { timeout: 30_000 },
  async ({ request, serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const { url } = await serve(join(root, 'index.html'));
    const response = await request.get(`${url}/%E0%A4%A`);

    expect(response.status()).toBe(404);
  },
);

test(
  'allows closing a served static server multiple times',
  { timeout: 30_000 },
  async ({ serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const server = await serve(join(root, 'index.html'));

    await server.close();
    await server.close();
  },
);

test('cleans up request and serve fixtures after a failed cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
  await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

  const fixturePath = join(root, 'cleanup.test.mjs');
  await writeFile(
    fixturePath,
    `
      import { test, expect } from ${JSON.stringify(join(__dirname, '../dist/index.js').replaceAll('\\', '/'))};

      let request;
      let url;

      const cleanupFailureTest = test.extend({
        userCleanup: async (_, use) => {
          await use(undefined);
          throw new Error('user cleanup failed');
        },
      });

      cleanupFailureTest.sequential('uses request and serve before cleanup failure', async ({ request: currentRequest, serve, userCleanup }) => {
        expect(userCleanup).toBeUndefined();
        request = currentRequest;
        url = (await serve(${JSON.stringify(join(root, 'index.html'))})).url;

        const response = await request.get(url);
        expect(response.ok()).toBe(true);
      });

      test.sequential('verifies cleanup', async () => {
        await expect(request.get('https://example.com')).rejects.toThrow();
        await expect(fetch(url)).rejects.toThrow();
        console.log('RSTEST_PLAYWRIGHT_CLEANUP_OK');
      });
    `,
  );

  const rootDir = join(__dirname, '../../..');
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [
      join(rootDir, 'packages/core/bin/rstest.js'),
      '--root',
      root,
      '--include',
      './cleanup.test.mjs',
    ],
    { cwd: rootDir },
  ).catch((error: { message?: string; stderr?: string; stdout?: string }) => ({
    stderr: `${error.message ?? ''}\n${error.stderr ?? ''}`,
    stdout: error.stdout ?? '',
  }));

  expect(`${stdout}\n${stderr}`).toContain('RSTEST_PLAYWRIGHT_CLEANUP_OK');
});
