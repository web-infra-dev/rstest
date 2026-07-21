# @rstest/playwright

Playwright fixture integration for Rstest. It provides Node-side Playwright fixtures and retrying Playwright-style assertions for tests running in Rstest workers.

Use `@rstest/playwright` for E2E tests against a complete page or app, such as a local dev server, a preview server, or a deployed URL. The test runs in a Node.js worker and uses Playwright to drive the page.

## When to use it

| Scenario                                                        | Recommended                                |
| --------------------------------------------------------------- | ------------------------------------------ |
| Test a component with Rstest's web bundling and browser runtime | Rstest browser mode with `@rstest/browser` |
| Test a complete app or page through `page.goto()`               | `@rstest/playwright`                       |
| Drive an existing dev server, preview server, or deployed URL   | `@rstest/playwright`                       |
| Need in-browser component test utilities                        | Rstest browser mode                        |

Because `@rstest/playwright` controls an external page instead of running the test in Rstest's browser runner, it does not use the Browser UI preview iframe. For visual debugging, use headed mode with `PWDEBUG=1`.

## Rstest playwright vs native playwright

`@rstest/playwright` and native Playwright use different runners and configuration files:

| Item          | `@rstest/playwright`                                  | Native Playwright                                  |
| ------------- | ----------------------------------------------------- | -------------------------------------------------- |
| Runner        | Rstest runner                                         | Playwright Test runner                             |
| Configuration | `rstest.config.ts` and `playwright` fixture overrides | `playwright.config.ts`                             |
| Test API      | Import `test` and `expect` from `@rstest/playwright`  | Import `test` and `expect` from `@playwright/test` |

Use `@rstest/playwright` when you want Playwright-driven E2E tests to run in the same Rstest workflow as the rest of your tests. Use native Playwright when you want the full Playwright Test runner workflow and its configuration model.

## Installation

```bash
pnpm add -D @rstest/playwright playwright
pnpm exec playwright install chromium
```

## Usage

```ts
import { expect, test } from '@rstest/playwright';

test('page title', async ({ page }) => {
  await page.goto('https://example.com');

  await expect(page).toHaveTitle(/Example/);
  await expect(page.locator('h1')).toHaveText('Example Domain');
});
```

## Fixtures

`test` extends Rstest with these Playwright fixtures:

- `browser`: a shared Chromium browser for the worker.
- `context`: an isolated `BrowserContext` that is closed after each test.
- `page`: an isolated `Page` that is closed after each test.
- `request`: an isolated `APIRequestContext` that is disposed after each test.
- `serve`: starts a static server from inside the test and cleans it up automatically.

The sections below show how each fixture is commonly used. `page` and `serve` link to the existing examples to avoid repeating the same code.

### `browser`

Use `browser` when you need to create a custom browser context yourself:

```ts
import { expect, test } from '@rstest/playwright';

test('custom browser context', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);

  await context.close();
});
```

### `context`

Use `context` when one test needs multiple pages that share the same browser context:

```ts
import { expect, test } from '@rstest/playwright';

test('multiple pages', async ({ context }) => {
  const page = await context.newPage();
  const popup = await context.newPage();

  await page.goto('https://example.com');
  await popup.goto('https://example.com');

  await expect(page).toHaveTitle(/Example/);
  await expect(popup).toHaveTitle(/Example/);
});
```

### `page`

See [Usage](#usage) for the common E2E flow of opening and asserting a page.

### `request`

Use `request` when you only need Playwright's API client and do not need to launch a browser:

```ts
import { expect, test } from '@rstest/playwright';

test('health check', async ({ request }) => {
  const response = await request.get('http://localhost:3000/health');

  expect(response.ok()).toBe(true);
});
```

### `serve`

See [Local app server](#local-app-server) for serving a built app from local files.

Lifecycle helpers can be imported from `@rstest/playwright`:

```ts
import { afterEach, beforeEach, describe } from '@rstest/playwright';

beforeEach(() => {});
afterEach(() => {});
describe('suite', () => {});
```

If your test modules do not rely on Node-side side effects that need isolation, set `isolate: false` in `rstest.config.ts` to reuse the worker module cache across test files and avoid repeated Playwright startup cost:

```ts
import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  testEnvironment: 'node',
});
```

## Assertions

`expect` delegates normal Rstest assertions to `@rstest/core`. When the actual value is a Playwright `Locator` or `Page`, it also provides these retrying Playwright-style async assertions:

### Locator assertions

- `toBeVisible(options?)`
- `toBeHidden(options?)`
- `toBeEnabled(options?)`
- `toBeDisabled(options?)`
- `toBeChecked(options?)`
- `toBeUnchecked(options?)`
- `toBeAttached(options?)`
- `toBeDetached(options?)`
- `toBeEditable(options?)`
- `toBeFocused(options?)`
- `toBeEmpty(options?)`
- `toBeInViewport(options?)`
- `toContainText(expected, options?)`
- `toHaveAttribute(name, expected?, options?)`
- `toHaveClass(expected, options?)`
- `toHaveCSS(propertyName, expected, options?)`
- `toHaveCount(expected, options?)`
- `toHaveId(expected, options?)`
- `toHaveJSProperty(name, expected, options?)`
- `toHaveText(expected, options?)`
- `toHaveValue(expected, options?)`

### Page assertions

- `toHaveTitle(expected, options?)`
- `toHaveURL(expected, options?)`

String text assertions normalize whitespace. Each Playwright-style assertion retries until it passes or reaches `options.timeout`.

## Configure playwright options

Global `playwright` configuration is not supported yet. Override the `playwright` fixture when a test file needs custom Playwright options:

```ts
import { expect, test } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const e2e = test.extend({
  playwright: {
    contextOptions: {
      viewport: { width: 390, height: 844 },
    },
  } satisfies PlaywrightOptions,
});

e2e('mobile page', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.locator('main')).toBeAttached();
});
```

## Trace debugging

Set `playwright.trace` or `RSTEST_PLAYWRIGHT_TRACE` to capture Playwright's official `trace.zip` artifact from the `context` fixture. The trace covers the default `page` fixture and pages created with `context.newPage()`. Fixture configuration takes priority over the environment variable, then falls back to `off`.

```ts
import { expect, test } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const e2e = test.extend({
  playwright: {
    trace: process.env.CI ? 'retain-on-failure' : 'off',
  } satisfies PlaywrightOptions,
});

e2e('checkout', async ({ page }) => {
  await page.goto('http://localhost:3000/checkout');
  await expect(page.locator('main')).toBeAttached();
});
```

For temporary CLI-style debugging without changing test code, set `RSTEST_PLAYWRIGHT_TRACE`:

```bash
RSTEST_PLAYWRIGHT_TRACE=retain-on-failure rstest
```

Use `RSTEST_PLAYWRIGHT_TRACE_OUTPUT_DIR` to override the default output directory when trace is enabled by the environment variable:

```bash
RSTEST_PLAYWRIGHT_TRACE=on RSTEST_PLAYWRIGHT_TRACE_OUTPUT_DIR=.rstest/playwright-traces rstest
```

`trace` accepts `'off'`, `'on'`, `'retain-on-failure'`, or an options object:

```ts
const e2e = test.extend({
  playwright: {
    trace: {
      mode: 'retain-on-failure',
      outputDir: '.rstest/playwright-traces',
      screenshots: true,
      snapshots: true,
      sources: true,
    },
  } satisfies PlaywrightOptions,
});
```

By default, traces are written to `.rstest/playwright-traces/<test-name>-<hash>/`. If the same test saves multiple traces, for example across retries, later attempts use a numeric suffix to avoid overwriting earlier traces. Every saved trace contains:

- `trace.zip`: Playwright's official trace artifact. Open it with `npx playwright show-trace <path-to-trace.zip>`.

When `summary` is enabled (the default), the directory also contains:

- `trace-summary.json`: Rstest-aware test metadata, artifact paths, and error stacks for tools and AI assistants.
- `debug.md`: a human-readable debugging report.

`trace.zip` is not a generic Chrome/Perfetto trace. It is Playwright's trace format and is intended to be inspected with Playwright Trace Viewer.

## Local app server

Use the `serve` fixture when a test needs to serve a built app. It starts a static server for the entry file and automatically stops the server after the test:

```ts
import { expect, test } from '@rstest/playwright';

test('home page', async ({ page, serve }) => {
  const { url } = await serve('./dist/index.html');

  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('Home');
});
```

In debug mode, `serve` keeps the server alive by default so the opened page remains available for inspection. In non-watch runs, this may keep the Rstest process open until you stop it manually. Pass `keepAliveOnDebug: false` to `serve` when the process should exit after the test.

For local debugging, set `PWDEBUG=1` to launch Chromium in headed mode with slow motion and DevTools enabled:

```bash
PWDEBUG=1 rstest watch
```

You can also override the debug defaults from the test:

```ts
import { test } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const e2e = test.extend({
  playwright: {
    debug: {
      enabled: true,
      slowMo: 100,
      devtools: false,
    },
  } satisfies PlaywrightOptions,
});

e2e('debug page', async ({ page }) => {
  await page.goto('http://localhost:3000');
});
```

To stop on a page while debugging, use Playwright's `page.pause()` with a zero test timeout:

```ts
test('debug page state', { timeout: 0 }, async ({ page, serve }) => {
  const { url } = await serve('./dist/index.html');

  await page.goto(url);
  await page.pause();
});
```

In debug mode, failed tests automatically call `page.pause()` before closing the page and context. Set `pauseOnFailure: false` in `debug` options, or `RSTEST_PLAYWRIGHT_PAUSE=false`, to disable this behavior.

For non-interactive debugging in CI or local runs, capture a screenshot when a test fails:

```ts
import { test } from '@rstest/playwright';

test('home page', async ({ onTestFailed, page, serve }) => {
  onTestFailed(async ({ task }) => {
    await page.screenshot({
      fullPage: true,
      path: `${task.id}-failed.png`,
    });
  });

  const { url } = await serve('./dist/index.html');

  await page.goto(url);
});
```

See `examples/playwright` for a complete Rsbuild + Playwright example.
