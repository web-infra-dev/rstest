const {
  ModuleFederationPlugin,
} = require('@module-federation/enhanced/rspack');
const path = require('node:path');

module.exports = {
  entry: './index.js',
  mode: 'development',
  devtool: 'hidden-source-map',
  target: 'async-node',
  output: {
    publicPath: 'http://localhost:3004/',
    clean: true,
    path: path.resolve(__dirname, 'dist-node'),
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'node_local_remote',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module' },
      runtimePlugins: ['@module-federation/node/runtimePlugin'],
      exposes: {
        './test': './src/test.js',
      },
    }),
  ],
};
