import { resolve } from 'node:path';
import { defineConfig } from '@rsbuild/core';

const root = __dirname;

export default defineConfig({
  source: {
    entry: {
      container: './src/main.tsx',
    },
  },
  output: {
    distPath: {
      js: 'container-static/js',
      css: 'container-static/css',
      svg: 'container-static/svg',
      font: 'container-static/font',
      image: 'container-static/image',
      media: 'container-static/media',
    },
  },
  html: {
    template: resolve(root, './src/index.html'),
  },
});
