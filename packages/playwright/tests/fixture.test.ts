import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const ciPlaywrightOptions = {
  browserName: 'chromium',
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
