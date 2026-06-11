import { defineConfig } from '@rslib/core';
import { publishCheckPlugins } from '../../scripts/publishCheckPlugins';
import { rsdoctorCIPlugin } from '../../scripts/rsdoctorPlugin';

export default defineConfig({
  plugins: publishCheckPlugins(),
  lib: [
    {
      format: 'esm',
      syntax: 'es2023',
      dts: {
        isolated: true,
      },
      redirect: {
        // Append `.js` to relative imports in emitted .d.ts so they resolve
        // under NodeNext/Node16 module resolution (ESM requires explicit ext).
        dts: { extension: true },
      },
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
