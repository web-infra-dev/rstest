# @rstest/adapter-rsbuild

Rstest adapter for [Rsbuild](https://rsbuild.rs) configuration. This package allows you to extend your Rstest configuration from Rsbuild config files.

## Installation

```bash
npm install @rstest/adapter-rsbuild -D
```

## Usage

### `withRsbuildConfig`

```ts
import { defineConfig } from '@rstest/core';
import { withRsbuildConfig } from '@rstest/adapter-rsbuild';

export default defineConfig({
  extends: withRsbuildConfig(),
  // other rstest config options
});
```

Automatically loads Rsbuild config from the current working directory and converts it to Rstest config.

More advanced usage examples can be found in the [Rsbuild integration guide](https://rstest.rs/guide/integration/rsbuild).

### `toRstestConfig`

You can also use `toRstestConfig` directly when you already have an Rsbuild config object.

```ts
import { loadConfig } from '@rsbuild/core';
import { toRstestConfig } from '@rstest/adapter-rsbuild';

const { content: rsbuildConfig } = await loadConfig({
  cwd: process.cwd(),
});

const rstestConfig = toRstestConfig({
  rsbuildConfig,
  environmentName: 'node',
  modifyRsbuildConfig: (config) => ({
    ...config,
    output: {
      ...config.output,
      target: 'node',
    },
  }),
});
```

### Options

- `rsbuildConfig`: Required. The Rsbuild config object to convert.
- `environmentName`: Optional. Name of the config in `environments` to merge with the base config.
- `modifyRsbuildConfig`: Optional. Hook to modify merged Rsbuild config before conversion.
