import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  plugins: [pluginReact()],
  name: 'react',
  testEnvironment: 'happy-dom',
  setupFiles: ['./test/rstest.setup.ts'],
  exclude: ['test/**/*.server.test.{ts,tsx}'],
});
