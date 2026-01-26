import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

// Configuration for server-side rendering (SSR) tests
export default defineConfig({
  plugins: [pluginReact()],
  name: 'react-ssr',
  testEnvironment: 'node',
  include: ['test/**/*.server.test.{ts,tsx}'],
});
