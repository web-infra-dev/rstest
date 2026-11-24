import { defineConfig, type RsbuildPlugin } from '@rstest/core';

const logCompiledEnvironmentsPlugin: RsbuildPlugin = {
  name: 'log-compiled-environments',
  setup(api) {
    api.onBeforeCreateCompiler(({ bundlerConfigs }) => {
      const names = bundlerConfigs
        .map((config) => config.name)
        .filter(Boolean)
        .sort();
      console.log(`COMPILED_ENVIRONMENTS=${JSON.stringify(names)}`);
    });
  },
};

export default defineConfig({
  projects: [
    {
      name: 'node',
      root: 'packages/node',
      globals: true,
      plugins: [logCompiledEnvironmentsPlugin],
    },
    {
      name: 'client',
      root: 'packages/client',
      globals: true,
      include: ['test/index.test.ts'],
      plugins: [logCompiledEnvironmentsPlugin],
    },
  ],
});
