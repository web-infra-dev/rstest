import { pluginLess } from '@rsbuild/plugin-less';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  include: ['errors/*.test.ts'],
  plugins: [pluginLess()],
});
