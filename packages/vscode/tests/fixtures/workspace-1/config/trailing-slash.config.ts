import path from 'node:path';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  root: `${path.resolve(__dirname, '..')}${path.sep}`,
});
