import { defineConfig } from '@rsbuild/core';
import { resolve } from 'pathe';

const root = __dirname;

export default defineConfig({
  source: {
    entry: {
      container: './src/browser/container/main.tsx',
    },
  },
  output: {
    distPath: {
      root: './dist/browser-container',
      js: 'container-static/js',
      css: 'container-static/css',
      svg: 'container-static/svg',
      font: 'container-static/font',
      image: 'container-static/image',
      media: 'container-static/media',
    },
  },
  html: {
    template: resolve(root, './src/browser/container/index.html'),
  },
});
