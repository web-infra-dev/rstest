import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack: {
      module: {
        parser: {
          javascript: {
            importDynamic: true,
            requireDynamic: true,
            requireResolve: true,
          },
        },
      },
    },
  },
});
