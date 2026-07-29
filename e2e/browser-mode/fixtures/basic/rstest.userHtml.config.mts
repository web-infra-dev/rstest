import { rspack, type RsbuildPlugin } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';
import { BROWSER_PORTS, BROWSER_TEST_TIMEOUT } from '../ports';

export default defineConfig({
  browser: {
    enabled: true,
    provider: 'playwright',
    headless: false,
    port: BROWSER_PORTS.basic,
  },
  include: ['tests/dom.test.ts'],
  plugins: [
    {
      name: 'test:user-html',
      setup(api) {
        api.modifyRspackConfig((config) => {
          config.plugins ??= [];
          config.plugins.push(
            new rspack.HtmlRspackPlugin({
              filename: 'index.html',
              template: './user.html',
            }),
          );
        });
      },
    } satisfies RsbuildPlugin,
  ],
  testTimeout: BROWSER_TEST_TIMEOUT,
});
