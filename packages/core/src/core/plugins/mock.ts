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

    compiler.hooks.thisCompilation.tap('CustomPlugin', (compilation) => {
      compilation.hooks.additionalTreeRuntimeRequirements.tap(
        'CustomPlugin',
        (chunk) => {
          compilation.addRuntimeModule(chunk, new RetestImportRuntimeModule());
        },
      );
    });
  }
}

export const pluginMock: RsbuildPlugin = {
  name: 'rstest:mock-runtime',
  setup: (api) => {
    api.modifyRspackConfig((rspackConfig) => {
      rspackConfig.output.asyncChunks = false;
      // TODO: remove this line after https://github.com/web-infra-dev/rspack/issues/11247 is resolved.
      rspackConfig.experiments!.incremental = false;
    });

    api.modifyBundlerChain((chain, utils) => {
      chain
        .plugin('RemoveDuplicateModulesPlugin')
        .use(utils.rspack.experiments.RemoveDuplicateModulesPlugin);
      // add mock-loader to this rule
      chain.module
        .rule(utils.CHAIN_ID.RULE.JS)
        .use('mock-loader')
        .loader(path.resolve(__dirname, './mockLoader.mjs'))
        // Right after SWC to only handle JS/TS files.
        .before(utils.CHAIN_ID.USE.SWC)
        .end();
    });

    api.modifyRspackConfig(async (config) => {
      config.plugins.push(new MockRuntimeRspackPlugin());
    });
  },
};
