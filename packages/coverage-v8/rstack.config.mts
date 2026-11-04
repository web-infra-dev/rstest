import { define } from 'rstack';
import { rslibRspackConfig } from '../../scripts/rslibConfig.ts';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin.ts';

define.lib({
  lib: [
    {
      syntax: 'es2021',
      dts: {
        isolated: true,
      },
    },
  ],
  tools: {
    rspack: {
      ...rslibRspackConfig,
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
