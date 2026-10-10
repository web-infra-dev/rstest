import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockRuntimeRspackPlugin {
  apply(compiler: Rspack.Compiler) {
    const { RuntimeGlobals, RuntimeModule } = compiler.webpack;

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

    compiler.hooks.thisCompilation.tap('RstestMockPlugin', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        'RstestAddMockRuntimePlugin',
        (chunk, runtimeRequirements) => {
          // `defineExportsWithCjsInterop` in the mock runtime calls `.r` and
          // `.d`. Rspack only emits them when an ESM module needs them, so a
          // CJS-only build graph would otherwise lack them.
          runtimeRequirements.add(RuntimeGlobals.makeNamespaceObject);
          runtimeRequirements.add(RuntimeGlobals.definePropertyGetters);
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
      config.plugins.push(new MockRuntimeRspackPlugin());
    });
  },
};
