import { defineConfig } from '@rstest/core';

export default defineConfig({
  tools: {
    rspack(config, { rspack, isServer }) {
      if (!isServer) {
        return;
      }

      config.plugins.push(
        new rspack.NormalModuleReplacementPlugin(
          /\.(css|less|sass|scss)(?:\?.*)?$/,
          (resource) => {
            resource.request = './style-proxy.cjs';
          },
        ),
      );
    },
  },
});
