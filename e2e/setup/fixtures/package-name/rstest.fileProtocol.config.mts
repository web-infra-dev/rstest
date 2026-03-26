import { join } from 'node:path';
import { defineConfig } from '@rstest/core';

import fse from 'fs-extra';

fse.copySync(
  join(__dirname, './test-setup-fixtures'),
  join(__dirname, './node_modules/test-setup'),
);

export default defineConfig({
  passWithNoTests: true,
  setupFiles: [import.meta.resolve('test-setup')],
  exclude: ['**/node_modules/**', '**/dist/**'],
});
