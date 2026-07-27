import { defineConfig } from '@rstest/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { join } from 'pathe';

export default defineConfig({
  plugins: [pluginReact()],
  coverage: {
    enabled: true,
    provider: 'v8',
    include: ['src/**/*.{js,jsx,ts,tsx}'],
    exclude: [
      join(__dirname, '../404.ts'),
      'a.ts',
      join(__dirname, 'src/b.ts'),
      './src/c.ts',
    ],
    clean: false,
    reporters: ['text', 'json-summary'],
  },
  setupFiles: ['./rstest.setup.ts'],
});
