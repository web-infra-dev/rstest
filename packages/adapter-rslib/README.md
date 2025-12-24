# @rstest/adapter-rslib

Rstest adapter for rslib configuration. This package allows you to extend your rstest configuration from rslib config files.

## Installation

```bash
npm install @rstest/adapter-rslib
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

Returns a promise that loads rslib config and converts it to rstest configuration.

#### Options

- `cwd` (string): Working directory passed to rslib's loadConfig. Default: `undefined`
- `configPath` (string): Path to rslib config file. Default: `'./rslib.config.ts'`
- `libIndex` (number | false): The lib config index in `lib` field to use. Set to a number to use the lib config at that index, or `false` to disable using the lib config. Default: `0`
- `modifyLibConfig` (function): Function to modify rslib config before conversion

The adapter automatically copies and maps compatible configuration options from rslib to rstest:

**From rslib → To rstest:**

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

## Advanced Usage

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

### Modifying rslib config

You can modify the rslib config before it gets converted to rstest config:

```typescript
export default defineConfig({
  extends: withRslibConfig({
    modifyLibConfig: (libConfig) => ({
      ...libConfig,
      source: {
        ...libConfig.source,
        define: {
          ...libConfig.source?.define,
          'process.env.TEST': '"true"',
        },
      },
    }),
  }),
});
```
