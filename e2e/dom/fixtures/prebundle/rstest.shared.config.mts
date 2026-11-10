import type { Rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: { name: 'jsdom', prebundle: true },
  include: ['./imports.test.ts', './mock.test.ts', './dynamic.test.ts'],
  globalSetup: ['./global-setup.ts'],
  setupFiles: ['./require-jsdom.cjs'],
  tools: {
    rspack: {
      plugins: [
        {
          apply(compiler: Rspack.Compiler) {
            compiler.hooks.compilation.tap(
              'assert-jsdom-external',
              (compilation) => {
                compilation.hooks.finishModules.tap(
                  'assert-jsdom-external',
                  (modules) => {
                    for (const module of modules) {
                      if (
                        'resource' in module &&
                        typeof module.resource === 'string' &&
                        /[\\/]jsdom[\\/]lib[\\/]/.test(module.resource)
                      ) {
                        throw new Error(
                          'jsdom must be shared with the test environment',
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
