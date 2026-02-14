import { resolve } from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';

const root = __dirname;

export default defineConfig({
  plugins: [pluginReact(), pluginSvgr()],
  server: {
    port: 7392,
  },
  dev: {
    client: {
      port: 7392,
    },
  },
  source: {
    entry: {
      index: './src/main.tsx',
      scheduler: './src/scheduler.ts',
    },
  },
  output: {
    assetPrefix: 'http://localhost:7392/',
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
