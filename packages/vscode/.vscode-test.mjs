import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'tests-dist/e2e/*.test.js',
});
