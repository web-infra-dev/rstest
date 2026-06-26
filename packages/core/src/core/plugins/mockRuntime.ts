import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockRuntimeRspackPlugin {
  constructor(private readonly outputModule: boolean) {}

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
        'RstestWasmRuntimePlugin',
        (module) => {
          if (module.name === 'async_wasm_loading') {
            const finalSource = module.source!.source.toString('utf-8').replace(
              // Replace readFile with readWasmFile to use the custom WASM file loader
              // Hard coded in EJS template https://github.com/web-infra-dev/rspack/tree/7df875eb3ca3bb4bcb21836fdf4e6be1f38a057c/crates/rspack_plugin_wasm/src/runtime
              'readFile(',
              this.outputModule ? 'import.meta.readWasmFile(' : 'readWasmFile(',
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
    api.modifyBundlerChain((chain) => {
      chain.module
        .rule('rstest-mock-module-doppelgangers')
        .test(/\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/)
        .with({ rstest: 'importActual' })
        .use('import-actual-loader')
        .loader(path.resolve(__dirname, './importActualLoader.mjs'))
        .end();
    });

    api.modifyRspackConfig((config) => {
      config.plugins.push(
        new MockRuntimeRspackPlugin(Boolean(config.output.module)),
      );
    });
  },
};
