import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

class IgnoreModuleNotFoundErrorPlugin {
  apply(compiler: Rspack.Compiler) {
    compiler.hooks.done.tap('Rstest:IgnoreModuleNotFoundPlugin', (stats) => {
      stats.compilation.errors = stats.compilation.errors.filter((error) => {
        if (/Module not found/.test(error.message)) {
          return false;
        }
        return true;
      });
    });
  }
}

/**
 * Module not found errors should be silent at build, and throw errors at runtime
 */
export const pluginIgnoreResolveError: RsbuildPlugin = {
  name: 'rstest:ignore-resolve-error',
  setup: (api) => {
    api.modifyRspackConfig(async (config) => {
      config.plugins!.push(new IgnoreModuleNotFoundErrorPlugin());
      config.optimization ??= {};
      config.optimization.emitOnErrors = true;

      config.ignoreWarnings ??= [];
      config.ignoreWarnings.push(/Module not found/);
    });
  },
};
