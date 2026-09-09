<picture>
  <img alt="Rstest Banner" src="https://assets.rspack.rs/rstest/rstest-banner.png">
</picture>

# @rstest/coverage-v8

[V8](https://v8.dev/) coverage provider for Rstest.

## Install

```bash
npm add @rstest/coverage-v8 -D
```

## Usage

Enable coverage collection in `rstest.config.ts`:

```ts
import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'v8',
  },
});
```
