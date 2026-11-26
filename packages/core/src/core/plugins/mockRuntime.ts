import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { InternalProjectContext } from '../../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class MockRuntimeRspackPlugin {
  constructor(private readonly federation: boolean) {}

  apply(compiler: Rspack.Compiler) {
    const { RuntimeGlobals, RuntimeModule } = compiler.webpack;

    const { federation } = this;
    class RetestImportRuntimeModule extends RuntimeModule {
      constructor() {
        super('rstest runtime');
      }

      override generate() {
        const runtime = fs.readFileSync(
          path.join(__dirname, 'mockRuntimeCode.js'),
          'utf8',
        );
        const federationRuntime = federation
          ? fs.readFileSync(
              path.join(__dirname, 'federationRuntimeCode.js'),
              'utf8',
            )
          : '';
        // The two runtime fragments share a single proxy on __webpack_require__.
        return `const rstestRequireHandlers = {};\n${runtime}\n${federationRuntime}`;
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

export const createMockRuntimePlugin = (
  projects?: InternalProjectContext[],
): RsbuildPlugin => ({
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

    api.modifyRspackConfig((config, { environment }) => {
      const project = projects?.find(
        (p) => p.environmentName === environment.name,
      );
      config.plugins.push(
        new MockRuntimeRspackPlugin(
          project?.normalizedConfig.federation === true,
        ),
      );
    });
  },
});

// Browser pages use the web federation runtime.
export const pluginMockRuntime: RsbuildPlugin = createMockRuntimePlugin();
