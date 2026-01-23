import { withRsbuildConfig } from '@rstest/adapter-rsbuild';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  // Keep the example aligned with the docs: inherit from `rsbuild.config.ts`
  // so users can configure Rsbuild in one place.
  extends: withRsbuildConfig({ cwd: __dirname }),
  setupFiles: ['./rstest.setup.ts'],
});
