# @rstest/midscene

`@rstest/midscene` lets you use Midscene AI actions directly in `@rstest/browser` browser mode tests.  
In test code, you call `agent.*` directly and focus on behavior; host-side config controls model/client/runtime behavior.

Current implementation is **Playwright-first** and aligned with the Playwright provider in `@rstest/browser`. Future provider adapters can be added if needed.

## What you can do

- Use AI actions in browser tests (`agent.aiTap`, `agent.aiInput`, `agent.aiAssert`, etc.)
- Reduce selector brittleness through natural language actions
- Centralize model, cache, and environment setup in `pluginMidscene`
- Route different test scopes (smoke/full/debug) through profiles

## Install

You need `@rstest/core`, `@rstest/browser`, and `@rstest/midscene`.  
`@rstest/midscene` currently requires Playwright in the dependency chain.

```bash
pnpm add -D @rstest/core @rstest/browser @rstest/midscene
pnpm add -D playwright
npx playwright install
```

## Quick start

### 1) Configure `rstest.config.ts`

```ts
import { defineConfig } from '@rstest/core';
import { pluginMidscene } from '@rstest/midscene/plugin';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  plugins: [pluginMidscene()],
});
```

### 2) Use `agent` in browser tests

```ts
import { test, expect } from '@rstest/core';
import { agent } from '@rstest/midscene';

test('add todo', async () => {
  await agent.aiAct('type "Hello Midscene" into the task title input');
  await agent.aiTap('Add button');
  await expect(
    agent.aiBoolean('Is there a task named "Hello Midscene"?'),
  ).resolves.toBe(true);
});
```

### 3) Prepare `.env` (optional)

`pluginMidscene()` tries to load `.env` from project root by default (or the path in `envPath`).

```bash
OPENAI_API_KEY=...
```

Model/API client configuration belongs to host side options (passed to `new Agent(...)`).

## Recommended host configuration for real projects

`pluginMidscene` runs in Node host, which is the right place for non-serializable and environment-specific options.

```ts
import { defineConfig } from '@rstest/core';
import { pluginMidscene } from '@rstest/midscene/plugin';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
  },
  plugins: [
    pluginMidscene({
      envPath: '.env',
      agentOptions: {
        replanningCycleLimit: 20,
      },
      profiles: {
        smoke: {
          replanningCycleLimit: 8,
        },
        full: {
          replanningCycleLimit: 30,
        },
      },
      resolveProfile: (ctx) =>
        ctx.testFile.includes('.smoke.') ? 'smoke' : 'full',
      createAgentOptions: async (ctx, profileName) => {
        const strategy = process.env.CI === 'true' ? 'read-only' : 'read-write';
        return {
          cache: {
            id: `midscene-${profileName || 'default'}-${ctx.testFile.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
            strategy,
          },
        };
      },
      getAgentCacheKey: (ctx, profileName) =>
        `${ctx.testFile}::${profileName || 'default'}`,
    }),
  ],
});
```

### Option meanings (priority order)

- `envPath`: `.env` file path, default is project root `.env`
- `agentOptions`: default `Agent` options for all tests
- `profiles`: profile map, e.g. `smoke`, `full`
- `resolveProfile`: selects profile using a fixed string or `(ctx) => profile`
- `createAgentOptions`: lazily computes options for each test file/profile (supports Promise)
- `getAgentCacheKey`: customize Agent cache key; default is `${testFile}::${profileName || 'default'}`

## Cache configuration

Midscene supports caching AI planning and element location to speed up test execution. Cache is configured in `agentOptions`:

```ts
pluginMidscene({
  agentOptions: {
    cache: {
      id: 'my-cache-id',
      strategy: 'read-write', // 'read-write' | 'read-only' | 'write-only'
    },
  },
});
```

### Cache strategies

- **`read-write`** (recommended for local): Reads existing cache, calls AI on miss and saves new cache
- **`read-only`** (recommended for CI): Only reads cache, never writes (requires cache files committed)
- **`write-only`** (force regenerate): Ignores existing cache, always calls AI and overwrites

### How cache generation works

Cache is **automatically generated** when you run tests:

1. **First run**: AI is called, results are cached to `./midscene_run/cache/*.cache.yaml`
2. **Subsequent runs**: Cache is used, ~45% faster execution

To force regenerate cache, temporarily switch to `write-only` strategy:

```ts
const strategy = process.env.REGENERATE_CACHE ? 'write-only' : 'read-write';
```

Then run:

```bash
REGENERATE_CACHE=1 pnpm test
```

### Performance impact

- Cache miss: ~51 seconds (calls AI model)
- Cache hit: ~28 seconds (reads from cache) ⚡

### Cache files location

Cache files are saved in YAML format at `./midscene_run/cache/`:

```yaml
- prompt: 'type "Hello" into the input'
  response:
    plan: [...]
    locate:
      xpath: "//input[@placeholder='Task title']"
```

For more details, see [Midscene cache documentation](https://midscenejs.com/caching).

## Runtime behavior from user perspective

- In browser mode, `agent.*` calls are dispatched through a namespace-based protocol.
- `@rstest/midscene` keeps Host-side Agent instances per `testFile + profile` for reuse.
- Each API call depends on the exposed host plugin; `pluginMidscene` must be enabled and browser mode active.
- Default RPC timeout is `120000ms` (see `AI_RPC_TIMEOUT_MS` in protocol implementation).

## Browser-side API

Methods below are available on `agent`:

- `agent.ai(prompt)` (alias for `agent.aiAct`)
- `agent.aiAct(prompt, options?)`
- `agent.aiTap(locate, options?)`
- `agent.aiHover(locate, options?)`
- `agent.aiInput(locate, options?)` (supports `aiInput(locate, { value })`)
- `agent.aiInput(locate, value, options?)` (supports separated value overload)
- `agent.aiKeyboardPress(locate, options?)` (supports `aiKeyboardPress(key, locate?, options?)`)
- `agent.aiScroll(locate, options?)` (supports scroll parameter overload)
- `agent.aiDoubleClick(locate, options?)`
- `agent.aiRightClick(locate, options?)`
- `agent.aiLocate(locate, options?)` (returns location info)
- `agent.aiAssert(assertion, errorMsg?, options?)`
- `agent.aiWaitFor(condition, options?)`
- `agent.aiQuery(dataDemand, options?)`
- `agent.aiAsk(prompt, options?)`
- `agent.aiBoolean(prompt, options?)`
- `agent.aiNumber(prompt, options?)`
- `agent.aiString(prompt, options?)`
- `agent.runYaml(yamlScriptContent)`
- `agent.setAIActContext(context)`
- `agent.evaluateJavaScript(script)`
- `agent.recordToReport(title?, options?)`
- `agent.freezePageContext()`
- `agent.unfreezePageContext()`
- `agent._unstableLogContent()`

## Practical example (combined flow)

```ts
import { test, expect } from '@rstest/core';
import { agent } from '@rstest/midscene';

test('order form flow', async () => {
  await agent.setAIActContext(
    'Only interact with the order form area. Ignore banners and floating widgets.',
  );

  await agent.aiTap('Username field');
  await agent.aiInput('Username field', 'qa-user');
  await agent.aiInput('Password field', {
    value: 'P@ssw0rd',
    mode: 'replace',
  });
  await agent.aiTap('Sign in button');

  await agent.aiWaitFor('A success toast appears');
  const message = await agent.aiAsk('What is the current status message?');
  expect(message).toContain('success');
});
```

## Troubleshooting

### `@rstest/midscene: @rstest/browser exposed API not found`

Browser mode is likely not running. Verify `browser.enabled = true` and `@rstest/browser` is installed.

### `Current provider: ...`

This version only supports `playwright`. Ensure `browser.provider` is `playwright`.

### `Cannot determine test file`

`agent` requires browser-mode runtime injection. Make sure tests are running in `rstest` browser mode, not plain Node mode.

### Timeout during AI call

AI call timeout is 120s by default. Start by simplifying prompts, reducing DOM complexity, or using a stronger model setting.

### No AI internal log output

`agent._unstableLogContent()` is a debug-only, unstable API and should not be used in stable assertions.

## Scope and limitations

- Browser mode + Playwright provider only
- `agent` API is the test-side interface; production behavior should be controlled via host config
- `_unstableLogContent` is intentionally unstable

## Adoption strategy

- Start with three core APIs: `aiTap`, `aiInput`, `aiAssert`
- Move reusable runtime/model settings into `agentOptions`
- Use `profiles` and `createAgentOptions` for file-level behavior differences
- Use `setAIActContext` first when prompts start to drift across cases

## License

MIT
