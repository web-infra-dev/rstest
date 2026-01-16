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

- `agent.aiTap(locator)`
- `agent.aiInput(locator, value)`
- `agent.aiAct(instruction)`
- `agent.aiAssert(assertion)`
- `agent.aiQuery(question)`
- `agent.aiWaitFor(condition, options?)`

## License

MIT
