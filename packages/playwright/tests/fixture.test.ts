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
