import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: 'project-node',
  include: ['tests/**/*.test.ts'],
  globalSetup: ['./globalSetup.ts'],
  plugins: [
    {
      name: 'test-node-global-teardown-order',
      setup(api) {
        api.onCloseDevServer(() => {
          console.log('[mixed-node-dev-server] closed');
        });
      },
    },
  ],
});
