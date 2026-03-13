# @rstest/adapter-rspack

Rstest adapter for [Rspack](https://rspack.rs) configuration. This package allows you to extend your Rstest configuration from Rspack config files.

## Installation

```bash
npm install @rstest/adapter-rspack -D
```

## Usage

### `withRspackConfig`

```ts
import { defineConfig } from '@rstest/core';
import { withRspackConfig } from '@rstest/adapter-rspack';

export default defineConfig({
  extends: withRspackConfig(),
  // other rstest config options
});
```

Automatically loads Rspack config from the current working directory and converts it to Rstest config.
