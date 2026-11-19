import { define } from 'rstack';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins.ts';
import { rslibRspackConfig } from '../../scripts/rslibConfig.ts';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';

define.lib({
  exports: {
    custom: (exports) => ({
      ...exports,
      '.': { import: exports['.'] },
      './config': { import: exports['./config'] },
      './package.json': './package.json',
    }),
  },
  plugins: publishCheckPlugins(),
  lib: [
    {
      syntax: 'es2023',
      dts: true,
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
        externals: {
          '@rstest/core': '@rstest/core',
          playwright: 'playwright',
        },
      },
    },
  ],
  source: {
    entry: {
      index: './src/index.ts',
      config: './src/config.ts',
    },
  },
  tools: {
    rspack: {
      ...rslibRspackConfig,
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
