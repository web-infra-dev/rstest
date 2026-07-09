import { defineConfig, type RsbuildPlugin } from '@rstest/core';

export default defineConfig({
  name: 'node',
  plugins: [
    {
      name: 'plugin',
      setup(api) {
        if (api.context.callerName !== 'rstest') {
          throw new Error(
            'This plugin should only be used in Rstest, please check your configuration.',
          );
        }
        api.transform({ test: /a.ts$/ }, ({ code }) => {
          return code.replace('count = 1', 'count = 2');
        });
      },
    } as RsbuildPlugin,
  ],
});
