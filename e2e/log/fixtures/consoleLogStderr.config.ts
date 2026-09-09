import { defineConfig } from '@rstest/core';

export default defineConfig({
  // Silence only stderr logs (console.error / console.warn) to verify the
  // `type` parameter, while letting stdout logs (console.log / console.info)
  // through.
  onConsoleLog: (_content, type) => type !== 'stderr',
});
