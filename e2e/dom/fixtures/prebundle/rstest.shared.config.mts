import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

export const environment =
  process.env.PREBUNDLE_ENVIRONMENT === 'happy-dom' ? 'happy-dom' : 'jsdom';
const happyDOM = environment === 'happy-dom';

export default defineConfig({
  testEnvironment: { name: environment, prebundle: true },
  include: happyDOM
    ? [
        './happy-imports.test.ts',
        './happy-mock.test.ts',
        './happy-dynamic.test.ts',
      ]
    : ['./imports.test.ts', './mock.test.ts', './dynamic.test.ts'],
  globalSetup: [happyDOM ? './global-setup-happy.ts' : './global-setup.ts'],
  setupFiles: [happyDOM ? './require-happy-dom.cjs' : './require-jsdom.cjs'],
  tools: {
    rspack: {
      plugins: [
        {
          apply(compiler: Rspack.Compiler) {
            compiler.hooks.compilation.tap(
              'assert-environment-external',
              (compilation) => {
                compilation.hooks.finishModules.tap(
                  'assert-environment-external',
                  (modules) => {
                    for (const module of modules) {
                      if (
                        'resource' in module &&
                        typeof module.resource === 'string' &&
                        /[\\/](?:jsdom|happy-dom)[\\/]lib[\\/]/.test(
                          module.resource,
                        )
                      ) {
                        throw new Error(
                          'DOM dependency must be shared with the test environment',
                        );
                      }
                    }
                  },
                );
              },
            );
          },
        },
      ],
    },
  },
});
