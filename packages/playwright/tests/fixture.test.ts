import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '../src';
import type { PlaywrightOptions } from '../src';

const debugOptions = {
  debug: {
    enabled: true,
    slowMo: 25,
    devtools: false,
  },
} satisfies PlaywrightOptions;

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

test.extend({
  playwright: {
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

test.extend({
  customFixture: async ({ page }, use) => {
    await use(`viewport-${page.viewportSize()?.width ?? 0}`);
  },
})('preserves extended fixture types', async ({ customFixture }) => {
  expect(customFixture).toContain('viewport');
});

test.extend<{ createLabel: () => Promise<string> }>({
  createLabel: async ({ page }, use) => {
    await use(async () => `viewport-${page.viewportSize()?.width ?? 0}`);
  },
})('preserves function-valued fixture types', async ({ createLabel }) => {
  await expect(createLabel()).resolves.toContain('viewport');
});

test.extend({
  playwright: debugOptions,
})('accepts headed debug options', async ({ playwright }) => {
  expect(playwright.debug).toEqual(debugOptions.debug);
});

test.extend({}).describe('extended test API', () => {
  test.extend({}).beforeEach(() => {});

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

test(
  'starts a static server from the serve fixture',
  async ({ request, serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const { url } = await serve(join(root, 'index.html'));
    const response = await request.get(url);

    expect(response.ok()).toBe(true);
    expect(await response.text()).toBe('<h1>ok</h1>');
  },
  { timeout: 30_000 },
);

test(
  'returns 404 for malformed static server paths',
  async ({ request, serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const { url } = await serve(join(root, 'index.html'));
    const response = await request.get(`${url}/%E0%A4%A`);

    expect(response.status()).toBe(404);
  },
  { timeout: 30_000 },
);

test(
  'allows closing a served static server multiple times',
  async ({ serve }) => {
    const root = await mkdtemp(join(tmpdir(), 'rstest-playwright-'));
    await writeFile(join(root, 'index.html'), '<h1>ok</h1>');

    const server = await serve(join(root, 'index.html'));

    await server.close();
    await server.close();
  },
  { timeout: 30_000 },
);
