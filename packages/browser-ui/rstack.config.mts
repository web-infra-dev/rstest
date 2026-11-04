import { resolve } from 'node:path';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';
import { define } from 'rstack';

const root = import.meta.dirname;

const isDev = process.argv.includes('dev');

define.app({
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
    },
  },
  output: {
    assetPrefix: isDev ? 'http://localhost:7392/' : undefined,
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
