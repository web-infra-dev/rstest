import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

class IgnoreModuleNotFoundErrorPlugin {
  apply(compiler: Rspack.Compiler) {
    compiler.hooks.done.tap('Rstest:IgnoreModuleNotFoundPlugin', (stats) => {
      for (let i = stats.compilation.errors.length - 1; i >= 0; i--) {
        if (/Module not found/.test(stats.compilation.errors[i]!.message)) {
          // Use `splice` instead of `filter` & `reassign` to avoid communication problems with Rust -> JS -> Rust
          stats.compilation.errors.splice(i, 1);
        }
      }
    });
  }
}

/**
 * Module not found errors should be silent at build, and throw errors at runtime
 */
export const pluginIgnoreResolveError: RsbuildPlugin = {
  name: 'rstest:ignore-resolve-error',
  setup: (api) => {
    api.modifyRspackConfig((config) => {
      config.plugins.push(new IgnoreModuleNotFoundErrorPlugin());
      config.optimization ??= {};
      config.optimization.emitOnErrors = true;

      config.ignoreWarnings ??= [];
      config.ignoreWarnings.push(/Module not found/);
    });
  },
};
