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

export const pluginMockRuntime: RsbuildPlugin = {
  name: 'rstest:mock-runtime',
  setup: (api) => {
    api.modifyRspackConfig(async (config) => {
      config.plugins!.push(new MockRuntimeRspackPlugin());
    });
  },
};
