import { pluginModuleFederation } from '@module-federation/rsbuild-plugin';
import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

/**
 * Node-targeted remote build used by Rstest's Module Federation test.
 * This differs from the browser build (rsbuild.browser.config.js):
 * - target: async-node
 * - includes a Node runtime plugin so remote chunks can be loaded over HTTP
 * - outputs to dist-node (served on a separate port from the browser remote)
 */
export default defineConfig({
  mode: 'development',
  environments: {
    node: {
      dev: {
        assetPrefix: 'http://localhost:3001/',
      },
      output: {
        assetPrefix: 'http://localhost:3001/',
      },
    },
  },
  server: {
    cors: {
      origin: 'http://localhost:3002',
    },
  },
  source: {
    entry: {
      index: {
        import: './index.js',
        html: false,
      },
    },
  },
  output: {
    assetPrefix: 'http://localhost:3001/',
    cleanDistPath: true,
    distPath: {
      root: 'dist-node',
    },
    emitCss: false,
    filenameHash: false,
    module: false,
    sourceMap: {
      js: 'hidden-source-map',
    },
    target: 'node',
  },
  plugins: [
    pluginReact(),
    pluginModuleFederation(
      {
        name: 'component_app',
        experiments: {
          asyncStartup: true,
        },
        filename: 'remoteEntry.cjs',
        exposes: {
          './Button': './src/Button.jsx',
          './Dialog': './src/Dialog.jsx',
          './Logo': './src/Logo.jsx',
          './ToolTip': './src/ToolTip.jsx',
        },
        shared: {
          react: { singleton: true, requiredVersion: '^19.2.0' },
          'react-dom': { singleton: true, requiredVersion: '^19.2.0' },
        },
      },
      { target: 'node' },
    ),
  ],
});
