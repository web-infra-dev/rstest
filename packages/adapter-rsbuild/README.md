# @rstest/adapter-rsbuild

Rstest adapter for [Rsbuild](https://rsbuild.rs) configuration. This package allows you to extend your Rstest configuration from Rsbuild config files.

## Installation

```bash
npm install @rstest/adapter-rsbuild -D
```

## Usage

```ts
import { defineConfig } from '@rstest/core';
import { withRsbuildConfig } from '@rstest/adapter-rsbuild';

export default defineConfig({
  extends: withRsbuildConfig(),
  // other rstest config options
});
```

More advanced usage examples can be found in the [Rsbuild integration guide](https://rstest.rs/guide/integration/rsbuild).
