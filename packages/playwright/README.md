# @rstest/playwright

Playwright fixture integration for Rstest. It provides Node-side Playwright fixtures and retrying Playwright-style assertions for tests running in Rstest workers.

Use `@rstest/playwright` for E2E tests against a complete page or app, such as a local dev server, a preview server, or a deployed URL. The test runs in a Node.js worker and uses Playwright to drive the page.

Rstest browser mode (`@rstest/browser`) has a different target. It is designed for component and in-browser tests. Rstest bundles the test and source modules for the browser, then runs the test code inside the browser runtime.

## When to use it

| Scenario                                                        | Recommended                                |
| --------------------------------------------------------------- | ------------------------------------------ |
| Test a component with Rstest's web bundling and browser runtime | Rstest browser mode with `@rstest/browser` |
| Test a complete app or page through `page.goto()`               | `@rstest/playwright`                       |
| Drive an existing dev server, preview server, or deployed URL   | `@rstest/playwright`                       |
| Need in-browser component test utilities                        | Rstest browser mode                        |

Because `@rstest/playwright` controls an external page instead of running the test in Rstest's browser runner, it does not use the Browser UI preview iframe. For visual debugging, use headed mode with `RSTEST_PLAYWRIGHT_DEBUG=true`.

## Installation

```bash
pnpm add -D @rstest/playwright playwright
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

Lifecycle helpers can be imported from `@rstest/playwright`:

```ts
import { afterEach, beforeEach, describe } from '@rstest/playwright';

beforeEach(() => {});
afterEach(() => {});
describe('suite', () => {});
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

## Configuration

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

For Playwright E2E projects, set `isolate: false` in `rstest.config.ts` so worker-level browser and server state can be reused predictably across test files:

```ts
import { defineConfig } from '@rstest/core';

export default defineConfig({
  isolate: false,
  testEnvironment: 'node',
});
```

Use the `serve` fixture when a test needs to serve a built app. It starts a static server for the entry file and automatically stops the server after the test:

```ts
import { expect, test } from '@rstest/playwright';

test('home page', async ({ page, serve }) => {
  const { url } = await serve('./dist/index.html');

  await page.goto(url);
  await expect(page.locator('h1')).toHaveText('Home');
});
```

In debug mode, `serve` keeps the server alive by default so the opened page remains available for inspection.

For local debugging, set `RSTEST_PLAYWRIGHT_DEBUG=true` to launch Chromium in headed mode with slow motion and DevTools enabled:

```bash
RSTEST_PLAYWRIGHT_DEBUG=true rstest watch
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
test(
  'debug page state',
  async ({ page, serve }) => {
    const { url } = await serve('./dist/index.html');

    await page.goto(url);
    await page.pause();
  },
  { timeout: 0 },
);
```

In debug mode, failed tests automatically call `page.pause()` before closing the page and context. Set `pauseOnFailure: false` in `debug` options, or `RSTEST_PLAYWRIGHT_PAUSE=false`, to disable this behavior.
