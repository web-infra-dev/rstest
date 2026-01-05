# @rstest/adapter-rsbuild

Rstest adapter for [Rsbuild](https://rsbuild.dev) configuration. This package allows you to extend your Rstest configuration from Rsbuild config files.

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

## API

### withRsbuildConfig(options)

Returns a configuration function that loads Rsbuild config and converts it to Rstest configuration.

#### Options

- `cwd` (string): `cwd` passed to loadConfig of Rsbuild. Default: `process.cwd()`
- `configPath` (string): Path to rsbuild config file. Default: `'./rsbuild.config.ts'`
- `environmentName` (string): The environment name in `environments` field to use, will be merged with the common config. Set to a string to use the environment config with matching name. Default: `undefined`
- `modifyRsbuildConfig` (function): Modify rsbuild config before converting to rstest config. Default: `undefined`

The adapter automatically copies and maps compatible configuration options from Rsbuild to Rstest:

**From Rsbuild → to Rstest:**

The adapter automatically maps these Rsbuild options to Rstest:

| Rsbuild option          | Rstest equivalent     | Notes                                |
| ----------------------- | --------------------- | ------------------------------------ |
| `name` from environment | `name`                | Environment identifier               |
| `plugins`               | `plugins`             | Plugin configuration                 |
| `source.decorators`     | `source.decorators`   | Decorator support                    |
| `source.define`         | `source.define`       | Global constants                     |
| `source.include`        | `source.include`      | Source inclusion patterns            |
| `source.exclude`        | `source.exclude`      | Source exclusion patterns            |
| `source.tsconfigPath`   | `source.tsconfigPath` | TypeScript config path               |
| `resolve`               | `resolve`             | Module resolution                    |
| `output.cssModules`     | `output.cssModules`   | CSS modules configuration            |
| `tools.rspack`          | `tools.rspack`        | Rspack configuration                 |
| `tools.swc`             | `tools.swc`           | SWC configuration                    |
| `tools.bundlerChain`    | `tools.bundlerChain`  | Bundler chain configuration          |
| `output.target`         | `testEnvironment`     | 'happy-dom' for web, 'node' for node |

## Advanced usage

### Specifying working directory

By default, the adapter uses `process.cwd()` as the working directory to resolve the Rsbuild config file.

When your Rsbuild config is in a different directory or you are running tests in a monorepo (which your `process.cwd()` is not your config directory), you can specify the `cwd` option to resolve the Rsbuild config file from a different directory.

```ts
export default defineConfig({
  extends: withRsbuildConfig({
    cwd: './packages/my-app',
  }),
});
```

### Using specific environment configuration

By default, the adapter uses the common configuration from Rsbuild.

If your Rsbuild config has multiple environment configurations:

```ts
// rsbuild.config.ts
export default {
  source: {
    define: {
      'process.env.NODE_ENV': '"development"',
    },
  },
  environments: {
    test: {
      source: {
        define: {
          'process.env.NODE_ENV': '"test"',
        },
      },
    },
    prod: {
      source: {
        define: {
          'process.env.NODE_ENV': '"production"',
        },
      },
    },
  },
};
```

You can then reference specific environment configurations in your Rstest config. Rstest will adapt the Rsbuild shared configuration and the environment configuration with a matching `environmentName` to Rstest format.

```ts
// For testing the 'test' environment
export default defineConfig({
  extends: withRsbuildConfig({
    environmentName: 'test',
  }),
  // test-environment-specific config
});
```

### Multiple environment configurations

When you need to test multiple parts of your application with different configurations independently, you can define multiple Rstest projects. Each project can extend a specific environment configuration by setting the `environmentName` option.

```ts
export default defineConfig({
  projects: [
    {
      extends: withRsbuildConfig({ environmentName: 'node' }),
      include: ['tests/node/**/*.{test,spec}.?(c|m)[jt]s'],
    },
    {
      extends: withRsbuildConfig({ environmentName: 'react' }),
      include: ['tests/react/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    },
  ],
});
```

### Modifying Rsbuild config

You can modify the Rsbuild config before it gets converted to Rstest config:

```ts
export default defineConfig({
  extends: withRsbuildConfig({
    modifyRsbuildConfig: (rsbuildConfig) => {
      delete rsbuildConfig.source?.define;
      return rsbuildConfig;
    },
  }),
});
```
