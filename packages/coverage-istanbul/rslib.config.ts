import { defineConfig } from '@rslib/core';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2023',
      dts: true,
      output: {
        sourceMap: process.env.SOURCEMAP === 'true',
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
