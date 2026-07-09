# @rstest/adapter-rspack

Rspack configuration adapter for Rstest. Converts Rspack config to Rstest config.

## Module structure

- `src/index.ts` — Package entry, exports `withRspackConfig` and `toRstestConfig`

## Commands

```bash
# Build
pnpm --filter @rstest/adapter-rspack build
pnpm --filter @rstest/adapter-rspack dev     # Watch mode

# Typecheck
pnpm --filter @rstest/adapter-rspack typecheck

# Test
pnpm --filter @rstest/adapter-rspack test
```

## Usage

```typescript
// rstest.config.ts
import { defineConfig } from '@rstest/core';
import { withRspackConfig } from '@rstest/adapter-rspack';

export default defineConfig({
  extends: withRspackConfig(),
});
```

## API

`withRspackConfig(options)` accepts:

- `cwd` — Working directory (default: `process.cwd()`)
- `configPath` — Path to rspack config file (default: `./rspack.config.ts`)
- `configName` — Select named config when using multiple Rspack configs
- `env` — Environment values passed to Rspack config function
- `nodeEnv` — `NODE_ENV` value used when loading config
- `modifyRspackConfig` — Callback to modify rspack config before conversion

## Do

- Follow existing config mapping conventions
- Keep the adapter lightweight
- Test with various rspack configurations

## Don't

- Don't add rspack-unrelated features
- Don't modify rspack config semantics
- Don't add heavy dependencies

## Key files

- `src/index.ts` — Main adapter logic and `withRspackConfig` function

## Safety

Allowed: read files, typecheck, build, run tests

Ask first: add dependencies, modify config mapping logic

## When stuck

Ask a clarifying question or propose a plan before making large changes.
