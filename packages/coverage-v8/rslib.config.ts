import { defineConfig } from '@rslib/core';
import { rslibRspackConfig } from '../../scripts/rslibConfig';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
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
