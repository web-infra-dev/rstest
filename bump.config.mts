import { defineConfig } from 'bumpp';

export default defineConfig({
  files: ['packages/*/package.json', '!packages/browser-ui/package.json'],
  commit: 'release: %s',
  tag: false,
  push: false,
});
