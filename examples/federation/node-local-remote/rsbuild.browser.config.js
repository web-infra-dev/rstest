const { pluginModuleFederation } = require('@module-federation/rsbuild-plugin');
const { defineConfig } = require('@rsbuild/core');

module.exports = defineConfig({
  mode: 'development',
  dev: {
    assetPrefix: 'http://localhost:3004/',
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
    assetPrefix: 'http://localhost:3004/',
    cleanDistPath: true,
    filenameHash: false,
    sourceMap: {
      js: 'hidden-source-map',
    },
  },
  plugins: [
    pluginModuleFederation({
      name: 'node_local_remote',
      experiments: {
        asyncStartup: true,
      },
      filename: 'remoteEntry.js',
      exposes: { './test': './src/test.js' },
      shared: {
        react: { singleton: true, requiredVersion: '^19.2.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.2.0' },
      },
    }),
  ],
});
