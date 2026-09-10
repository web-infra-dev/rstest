import { fileURLToPath } from 'node:url';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginSass } from '@rsbuild/plugin-sass';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  projects: [
    ...(['node', 'jsdom', 'happy-dom'] as const).map((testEnvironment) => ({
      name: testEnvironment,
      testEnvironment,
      include: ['empty.test.ts'],
    })),
    {
      name: 'compiled',
      include: ['compiled.test.ts'],
      plugins: [
        pluginLess({ lessLoaderOptions: { additionalData: '@color: red;' } }),
        pluginSass(),
      ],
      output: { cssModules: { localIdentName: 'configured_[local]' } },
    },
    {
      name: 'custom',
      include: ['custom.test.ts'],
      resolve: {
        alias: {
          'aliased.less$': fileURLToPath(
            new URL('./stub.mjs', import.meta.url),
          ),
        },
      },
      tools: {
        rspack: {
          module: {
            rules: [
              { test: /\.scss$/, type: 'asset/source' },
              {
                test: /\.less$/,
                oneOf: [
                  { resourceQuery: /raw/, type: 'asset/source' },
                  {
                    resourceQuery: /^$/,
                    use: [
                      {
                        loader: fileURLToPath(
                          new URL('./customLoader.mjs', import.meta.url),
                        ),
                        options: { value: 'custom-value' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ],
});
