import { defineConfig } from '@rstest/core';

export default defineConfig(() => {
  throw new Error('Intentional config error for testing');
});
