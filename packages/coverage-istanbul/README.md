<picture>
  <img alt="Rstest Banner" src="https://assets.rspack.rs/rstest/rstest-banner.png">
</picture>

# @rstest/coverage-istanbul

[Istanbul](https://istanbul.js.org/) coverage provider for Rstest.

## Install

```bash
npm add @rstest/coverage-istanbul -D
```

## Usage

Enable coverage collection in `rstest.config.ts`:

```ts
import { defineConfig } from '@rstest/core';

export default defineConfig({
  coverage: {
    enabled: true,
    provider: 'istanbul',
  },
});
```
