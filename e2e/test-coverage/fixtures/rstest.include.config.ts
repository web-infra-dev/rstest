import { defineConfig } from '@rstest/core';
import { join } from 'pathe';

export default defineConfig({
  source: {
    transformImport: [
      {
        libraryName: 'demo-lib',
        libraryDirectory: '.',
      },
    ],
  },
  coverage: {
    enabled: true,
    provider: 'istanbul',
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
