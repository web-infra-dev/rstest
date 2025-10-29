import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockRuntimeRspackPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeModule } = compiler.webpack;

    class RetestImportRuntimeModule extends RuntimeModule {
      constructor() {
        super('rstest runtime');
      }

      override generate() {
        const code = fs.readFileSync(
          path.join(__dirname, './mockRuntimeCode.js'),
          'utf8',
        );

        return code;
      }
    }

    compiler.hooks.compilation.tap('RstestMockPlugin', (compilation) => {
      compilation.hooks.runtimeModule.tap(
        'RstestMockChunkLoadingRuntimePlugin',
        (module) => {
          if (module.name === 'require_chunk_loading') {
            const finalSource = module.source!.source.toString('utf-8').replace(
              // Hard coded in EJS template https://github.com/web-infra-dev/rspack/blob/5b89b0b9810f15c6bd6494b9a3389db3071d93d1/crates/rspack_plugin_runtime/src/runtime_module/runtime/require_chunk_loading.ejs.
              'for (var moduleId in moreModules) {',
              'for (var moduleId in moreModules) {\n' +
                '\t\tif (Object.keys(__webpack_require__.rstest_original_modules).includes(moduleId)) continue;',
            );
            module.source!.source = Buffer.from(finalSource);
          }

          if (module.name === 'define_property_getters') {
            const finalSource = module.source!.source.toString('utf-8').replace(
              // Sets the object configurable so that imported properties can be spied
              // Hard coded in EJS template https://github.com/web-infra-dev/rspack/blob/main/crates/rspack_plugin_runtime/src/runtime_module/runtime/define_property_getters.ejs
              'enumerable: true, get:',
              'enumerable: true, configurable: true, get:',
            );

            module.source!.source = Buffer.from(finalSource);
          }
        },
      );
    });

    compiler.hooks.thisCompilation.tap('RstestMockPlugin', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        'RstestAddMockRuntimePlugin',
        (chunk) => {
          compilation.addRuntimeModule(chunk, new RetestImportRuntimeModule());
        },
      );
    });
  }
}

export const pluginMockRuntime: RsbuildPlugin = {
  name: 'rstest:mock-runtime',
  setup: (api) => {
    api.modifyRspackConfig(async (config) => {
      config.plugins.push(new MockRuntimeRspackPlugin());
    });
  },
};
