import { defineConfig } from '@rstest/core';
import { join } from 'pathe';

export default defineConfig({
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
    reporters: ['text'],
  },
  setupFiles: ['./rstest.setup.ts'],
});
