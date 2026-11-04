import { define } from 'rstack';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins.ts';
import { rslibRspackConfig } from '../../scripts/rslibConfig.ts';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';

define.lib({
  plugins: publishCheckPlugins(),
  output: {
    // Bundle the shared config helpers into the adapter's dist so it carries no
    // runtime dependency on a core subpath; `false` opts this exact subpath out
    // of autoExternal.
    externals: {
      '@rstest/core/internal/adapter': false,
    },
  },
  lib: [
    {
      dts: {
        isolated: true,
        bundle: true,
      },
      bundle: true,
      syntax: 'es2023',
    },
  ],
  tools: {
    rspack: {
      ...rslibRspackConfig,
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
