# @rstest/rsbuild-config-bridge

Bridge utilities for converting [Rsbuild](https://rsbuild.rs) configuration to Rstest configuration.

## Installation

```bash
npm install @rstest/rsbuild-config-bridge -D
```

## Usage

```ts
import { convertRsbuildToRstestConfig } from '@rstest/rsbuild-config-bridge';

const rstestConfig = convertRsbuildToRstestConfig({
  rsbuildConfig,
  environmentName: 'web',
});
```
