# @rstest/adapter-rslib

Rstest adapter for [Rslib](https://rslib.rs) configuration. This package allows you to extend your Rstest configuration from Rslib config files.

## Installation

```bash
npm install @rstest/adapter-rslib -D
```

## Usage

```ts
import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '@rstest/adapter-rslib';

export default defineConfig({
  extends: withRslibConfig(),
  // other rstest config options
});
```

More advanced usage examples can be found in the [Rslib integration guide](https://rstest.rs/guide/integration/rslib).
