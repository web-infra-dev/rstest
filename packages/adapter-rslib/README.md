# @rstest/adapter-rslib

Rstest adapter for [Rslib](https://rslib.rs) configuration. This package allows you to extend your Rstest configuration from Rslib config files.

## Installation

```bash
npm install @rstest/adapter-rslib -D
```

## Usage

```typescript
import { defineConfig } from '@rstest/core';
import { withRslibConfig } from '@rstest/adapter-rslib';

export default defineConfig({
  extends: withRslibConfig(),
  // other rstest config options
});
```

## API

### withRslibConfig(options)

Returns a promise that loads Rslib config and converts it to Rstest configuration.

#### Options

- `cwd` (string): Working directory passed to Rslib's loadConfig. Default: `process.cwd()`
- `configPath` (string): Path to Rslib config file. Default: `'./rslib.config.ts'`
- `libIndex` (number | false): The lib config index in `lib` field to use. Set to a number to use the lib config at that index, or `false` to disable using the lib config. Default: `0`
- `modifyLibConfig` (function): Function to modify Rslib config before conversion. Default: `undefined`

The adapter automatically copies and maps compatible configuration options from Rslib to Rstest:

**From Rslib → to Rstest:**

- `root` → `root`
- `lib[libIndex]?.id` → `name`
- `plugins` → `plugins`
- `source.decorators` → `source.decorators`
- `source.define` → `source.define`
- `source.include` → `source.include`
- `source.exclude` → `source.exclude`
- `source.tsconfigPath` → `source.tsconfigPath`
- `resolve` → `resolve`
- `output.cssModules` → `output.cssModules`
- `tools.rspack` → `tools.rspack`
- `tools.swc` → `tools.swc`
- `tools.bundlerChain` → `tools.bundlerChain`
- `output.target` → `testEnvironment` ('happy-dom' for web and 'node' for node)

## Advanced usage

### Using specific lib configuration

If your rslib config has multiple lib configurations, you can specify which one to use:

```typescript
export default defineConfig({
  extends: withRslibConfig({
    libIndex: 1, // Use the second lib configuration
  }),
});
```

### Disabling lib configuration

To use only the base rslib config without any lib-specific overrides:

```typescript
export default defineConfig({
  extends: withRslibConfig({
    libIndex: false,
  }),
});
```

### Custom working directory

When your rslib config is in a different directory:

```typescript
export default defineConfig({
  extends: withRslibConfig({
    cwd: './packages/my-lib',
    configPath: './rslib.config.ts',
  }),
});
```

### Modifying Rslib config

You can modify the Rslib config before it gets converted to Rstest config:

```typescript
export default defineConfig({
  extends: withRslibConfig({
    modifyLibConfig: (libConfig) => {
      delete libConfig.source?.define;
      return libConfig;
    },
  }),
});
```
