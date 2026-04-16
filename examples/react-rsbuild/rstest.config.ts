import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withRsbuildConfig } from '@rstest/adapter-rsbuild';
import { defineConfig } from '@rstest/core';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  extends: withRsbuildConfig({ cwd: dirname }),
  setupFiles: ['./test/rstest.setup.ts'],
});
