import { expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const test = base.extend({
  playwright: {
    browserName: 'chromium',
    // This example uses the CI-provided Chrome binary to avoid installing
    // Playwright Chromium. This does not change @rstest/playwright defaults.
    launchOptions: process.env.CI ? { channel: 'chrome' } : undefined,
  } satisfies PlaywrightOptions,
});

test(
  'opens the built Rsbuild page',
  { timeout: 15_000 },
  async ({ onTestFailed, page, serve }) => {
    onTestFailed(async ({ task }) => {
      await page.screenshot({
        fullPage: true,
        path: `${task.id}-failed.png`,
        timeout: 5_000,
      });
    });

    const { url } = await serve('./dist/index.html');

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const content = await page.locator('main').evaluate((element) => ({
      title: document.title,
      heading: element.querySelector('h1')?.textContent,
      message: element.querySelector('.message')?.textContent,
    }));

    expect(content).toEqual({
      title: 'Rstest Playwright Example',
      heading: 'Rstest Playwright Example',
      message: 'Built by Rsbuild and tested with Playwright.',
    });
  },
);
