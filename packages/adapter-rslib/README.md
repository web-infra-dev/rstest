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

## API

### withRslibConfig(options)

Returns a promise that loads Rslib config and converts it to Rstest configuration.

#### Options

- `cwd` (string): Working directory to resolve Rslib config file. Default: `process.cwd()`
- `configPath` (string): Path to Rslib config file. Default: `'./rslib.config.ts'`
- `libId` (string): The lib config id in `lib` field to use. Set to a string to use the lib config with matching id. Default: `undefined`
- `modifyLibConfig` (function): Function to modify Rslib config before conversion. Default: `undefined`

The adapter automatically copies and maps compatible configuration options from Rslib to Rstest:

**From Rslib → to Rstest:**

The adapter automatically maps these Rslib options to Rstest:

| Rslib option          | Rstest equivalent     | Notes                                |
| --------------------- | --------------------- | ------------------------------------ |
| `lib.id`              | `name`                | Library identifier                   |
| `plugins`             | `plugins`             | Plugin configuration                 |
| `source.decorators`   | `source.decorators`   | Decorator support                    |
| `source.define`       | `source.define`       | Global constants                     |
| `source.include`      | `source.include`      | Source inclusion patterns            |
| `source.exclude`      | `source.exclude`      | Source exclusion patterns            |
| `source.tsconfigPath` | `source.tsconfigPath` | TypeScript config path               |
| `resolve`             | `resolve`             | Module resolution                    |
| `output.cssModules`   | `output.cssModules`   | CSS modules configuration            |
| `tools.rspack`        | `tools.rspack`        | Rspack configuration                 |
| `tools.swc`           | `tools.swc`           | SWC configuration                    |
| `tools.bundlerChain`  | `tools.bundlerChain`  | Bundler chain configuration          |
| `output.target`       | `testEnvironment`     | 'happy-dom' for web, 'node' for node |

## Advanced usage

### Specifying working directory

By default, the adapter uses `process.cwd()` as the working directory to resolve the Rslib config file.

When your Rslib config is in a different directory or you are running tests in a monorepo (which your `process.cwd()` is not your config directory), you can specify the `cwd` option to resolve the Rslib config file from a different directory.

```ts
export default defineConfig({
  extends: withRslibConfig({
    cwd: './packages/my-lib',
  }),
});
```

### Using specific lib configuration

By default, the adapter does not use any lib configuration from Rslib.

If your Rslib config has multiple lib configurations with different `id` values:

```ts
// rslib.config.ts
export default defineConfig({
  lib: [
    {
      id: 'core',
      format: 'esm',
      dts: true,
      source: {
        define: {
          IS_CORE: true,
        },
      },
    },
    {
      id: 'utils',
      format: 'esm',
      source: {
        define: {
          IS_CORE: false,
        },
      },
    },
  ],
  // shared config
});
```

You can then reference specific lib configurations in your Rstest config, Rstest will adapt the Rslib shared configuration and lib configuration with matching `id` value to Rstest format.

```ts
// For testing the core library
export default defineConfig({
  extends: withRslibConfig({
    libId: 'core',
  }),
  // core-specific test config
});
```

### Multiple lib configurations

When you need to test multiple libraries with different configurations independently, you can define multiple Rstest projects. Each project can extend a specific library configuration by setting the `libId` option.

```ts
export default defineConfig({
  projects: [
    {
      extends: withRslibConfig({ libId: 'node' }),
      include: ['tests/node/**/*.{test,spec}.?(c|m)[jt]s'],
    },
    {
      extends: withRslibConfig({ libId: 'react' }),
      include: ['tests/react/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    },
  ],
});
```

### Modifying Rslib config

You can modify the Rslib config before it gets converted to Rstest config:

```ts
export default defineConfig({
  extends: withRslibConfig({
    modifyLibConfig: (libConfig) => {
      delete libConfig.source?.define;
      return libConfig;
    },
  }),
});
```
