import { defineConfig } from '@rstest/core';

export default defineConfig({
  globalSetup: ['./setups/defaultExport.ts', './setups/namedExports.ts'],
  plugins: [
    {
      name: 'test-global-teardown-order',
      setup(api) {
        api.onCloseDevServer(() => {
          console.log('[rstest-dev-server] closed');
        });
      },
    },
  ],
});
