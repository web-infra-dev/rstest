import { fileURLToPath } from 'node:url';
import { defineConfig } from '@rstest/core';

const entry = fileURLToPath(new URL('./price.test.mjs', import.meta.url));
const files = ['provider.cjs', 'helper.cjs'].map((file) =>
  fileURLToPath(new URL(`./native/${file}`, import.meta.url)),
);
const complete = process.env.COMPLETE_NATIVE_INPUTS === '1';

export default defineConfig({
  include: ['*.test.mjs'],
  reporters: [['json', { outputPath: './report.json' }]],
  tools: {
    rspack: {
      module: {
        // Ordinary require in this ESM entry remains a native runtime call.
        // Bundling the provider would hide the dependency-selection regression.
        rules: [
          { test: /\.test\.mjs$/, type: 'javascript/esm' },
          ...(complete
            ? [
                {
                  include: entry,
                  enforce: 'pre',
                  use: {
                    loader: fileURLToPath(
                      new URL('./native-inputs-loader.mjs', import.meta.url),
                    ),
                    options: { files },
                  },
                },
              ]
            : []),
        ],
      },
      plugins: [
        {
          apply(compiler) {
            compiler.hooks.thisCompilation.tap(
              'ExperimentalCompleteNativeInputs',
              (compilation) => {
                compilation.hooks.finishModules.tap(
                  'ExperimentalCompleteNativeInputs',
                  (modules) => {
                    for (const module of modules) {
                      const resource = module.nameForCondition();
                      if (files.includes(resource)) {
                        throw new Error(
                          'Native fixture inputs must not be bundled.',
                        );
                      }
                      if (complete && resource === entry) {
                        module.buildInfo.rstestDeclaredRuntimeDependencies = {
                          version: 1,
                          complete: true,
                          files,
                        };
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
