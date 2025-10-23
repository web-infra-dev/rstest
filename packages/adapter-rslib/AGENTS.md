# @rstest/adapter-rslib

Rslib configuration adapter for Rstest. Converts Rslib config to Rstest config.

## Module structure

- `src/index.ts` — Package entry, exports `withRslibConfig`
- `src/tsconfig.ts` — Tsconfig loading utilities

## Commands

```bash
# Build
pnpm --filter @rstest/adapter-rslib build
pnpm --filter @rstest/adapter-rslib dev     # Watch mode

# Typecheck
pnpm --filter @rstest/adapter-rslib typecheck

# Test
pnpm --filter @rstest/adapter-rslib test
```

## Usage

```typescript
// rstest.config.ts
import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '@rstest/adapter-rslib';

export default defineConfig({
  extends: [withRslibConfig()],
});
```

## API

`withRslibConfig(options)` accepts:

- `cwd` — Working directory (default: `process.cwd()`)
- `configPath` — Path to rslib config file (default: `./rslib.config.ts`)
- `libId` — Specific lib config id to use from `lib` array
- `modifyLibConfig` — Callback to modify rslib config before conversion

## Do

- Follow existing config mapping conventions
- Keep the adapter lightweight
- Test with various rslib configurations

## Don't

- Don't add rslib-unrelated features
- Don't modify rslib config semantics
- Don't add heavy dependencies

## Key files

- `src/index.ts` — Main adapter logic and `withRslibConfig` function
- `src/tsconfig.ts` — Tsconfig loader for decorator version detection

## Safety

Allowed: read files, typecheck, build, run tests

Ask first: add dependencies, modify config mapping logic

## When stuck

Ask a clarifying question or propose a plan before making large changes.
