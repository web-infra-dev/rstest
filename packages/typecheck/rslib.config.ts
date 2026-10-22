import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rslibRspackConfig } from '../../scripts/rslibConfig';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [{ syntax: 'es2023', dts: { isolated: true } }],
  source: { entry: { index: './src/index.ts', internal: './src/internal.ts' } },
  tools: { rspack: rslibRspackConfig },
});
