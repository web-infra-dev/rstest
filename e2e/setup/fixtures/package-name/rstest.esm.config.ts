import { join } from 'node:path';
import { defineConfig } from '@rstest/core';

import fse from 'fs-extra';

fse.copySync(
  join(__dirname, './test-setup-esm-fixtures'),
  join(__dirname, './node_modules/test-setup-esm'),
);

export default defineConfig({
  passWithNoTests: true,
  setupFiles: ['test-setup-esm'],
  exclude: ['**/node_modules/**', '**/dist/**'],
});
