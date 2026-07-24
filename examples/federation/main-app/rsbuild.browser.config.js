const { pluginModuleFederation } = require('@module-federation/rsbuild-plugin');
const { defineConfig } = require('@rsbuild/core');
const { pluginReact } = require('@rsbuild/plugin-react');

module.exports = defineConfig({
  mode: 'development',
  dev: {
    assetPrefix: 'http://localhost:3002/',
  },
  source: {
    entry: {
      index: './index.js',
    },
  },
  output: {
    assetPrefix: 'http://localhost:3002/',
    cleanDistPath: true,
    filenameHash: false,
    sourceMap: {
      js: 'hidden-source-map',
    },
  },
  html: {
    template: './public/index.html',
  },
  plugins: [
    pluginReact(),
    pluginModuleFederation({
      name: 'main_app',
      experiments: {
        asyncStartup: true,
      },
      remoteType: 'script',
      remotes: {
        'component-app': 'component_app@http://localhost:3001/remoteEntry.js',
        'node-local-remote':
          'node_local_remote@http://localhost:3004/remoteEntry.js',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.0' },
      },
    }),
  ],
});
