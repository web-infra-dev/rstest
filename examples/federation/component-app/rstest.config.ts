import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  testEnvironment: 'node',
  plugins: [pluginReact()],
  testTimeout: 15000,
});
