import type { RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    {
      name: 'node',
      root: 'packages/node',
      plugins: [
        {
          name: 'report-compiler-parallelism',
          setup(api) {
            api.onAfterCreateCompiler(({ compiler }) => {
              if ('compilers' in compiler) {
                console.log(
                  'Compiler parallelism:',
                  compiler.options.parallelism,
                );
              }
            });
          },
        } satisfies RsbuildPlugin,
      ],
      globals: true,
    },
    {
      name: 'client',
      root: 'packages/client',
      globals: true,
      include: ['test/index.test.ts'],
    },
  ],
});
