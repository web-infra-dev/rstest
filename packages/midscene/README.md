# @rstest/midscene

Midscene integration for Rstest browser mode.

This package now exposes an AI-first API through `agent.*` and a host plugin
bridge (`pluginMidscene`).

## Installation

```bash
pnpm add @rstest/midscene
```

## Setup

```ts
// rstest.config.ts
import { defineConfig } from '@rstest/core';
import { pluginMidscene } from '@rstest/midscene/plugin';

export default defineConfig({
  browser: {
    enabled: true,
  },
  plugins: [pluginMidscene()],
});
```

## Host-side configuration (layered)

`pluginMidscene` runs on the host (Node.js), so this is the right place to set
non-serializable or infra-level Midscene options.

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

      // Base options applied to all Midscene Agent instances
      agentOptions: {
        replanningCycleLimit: 20,
        cache: {
          id: 'rstest-midscene-default',
          strategy: process.env.CI ? 'read-only' : 'read-write',
        },
      },

      // Optional named profiles
      profiles: {
        smoke: {
          replanningCycleLimit: 8,
        },
        full: {
          replanningCycleLimit: 30,
        },
      },

      // Choose profile per test file
      resolveProfile: (ctx) =>
        ctx.testFile.includes('.smoke.') ? 'smoke' : 'full',

      // Dynamic host-side options per test file/profile
      createAgentOptions: (ctx, profileName) => ({
        cache: {
          id: `midscene-${profileName || 'default'}-${ctx.testFile.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          strategy: process.env.CI ? 'read-only' : 'read-write',
        },
      }),
    }),
  ],
});
```

Runtime behavior stays in test code (`agent.setAIActContext`, per-call options
like `cacheable/deepThink`, `aiWaitFor` timeouts, etc.), while host-side model,
cache strategy, and client wrappers stay in `pluginMidscene(...)`.

## Usage

```ts
import { test } from '@rstest/core';
import { agent } from '@rstest/midscene';

test('ai action', async () => {
  await agent.aiAct('type "Hello Midscene" into the input field');
  await agent.aiAssert('The input now contains Hello Midscene');
});
```

## API

- `agent.ai(prompt)`
- `agent.aiAct(prompt, options?)`
- `agent.aiTap(locate, options?)`
- `agent.aiHover(locate, options?)`
- `agent.aiInput(...)` (supports `aiInput(locate, { value })` and `aiInput(locate, value, options?)`)
- `agent.aiKeyboardPress(...)` (supports both Midscene signatures)
- `agent.aiScroll(...)` (supports both Midscene signatures)
- `agent.aiDoubleClick(locate, options?)`
- `agent.aiRightClick(locate, options?)`
- `agent.aiAsk(prompt, options?)`
- `agent.aiQuery(dataDemand, options?)`
- `agent.aiBoolean(prompt, options?)`
- `agent.aiNumber(prompt, options?)`
- `agent.aiString(prompt, options?)`
- `agent.aiAssert(assertion, errorMsg?, options?)`
- `agent.aiLocate(locate, options?)`
- `agent.aiWaitFor(assertion, options?)`
- `agent.runYaml(yamlScriptContent)`
- `agent.setAIActContext(context)`
- `agent.evaluateJavaScript(script)`
- `agent.recordToReport(title?, options?)`
- `agent.freezePageContext()`
- `agent.unfreezePageContext()`
- `agent._unstableLogContent()`

## License

MIT
