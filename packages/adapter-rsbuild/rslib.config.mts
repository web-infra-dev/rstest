import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
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
      format: 'esm',
      dts: {
        isolated: true,
        bundle: true,
      },
      bundle: true,
      syntax: 'es2023',
      experiments: {
        advancedEsm: true,
      },
    },
  ],
  tools: {
    rspack: {
      plugins: [rsdoctorCIPlugin()].filter(Boolean),
    },
  },
});
