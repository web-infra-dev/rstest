const { HtmlRspackPlugin } = require('@rspack/core');
const {
  ModuleFederationPlugin,
} = require('@module-federation/enhanced/rspack');

module.exports = {
  entry: './index.js',
  mode: 'development',
  devtool: 'hidden-source-map',
  output: {
    publicPath: 'http://localhost:3002/',
    clean: true,
  },
  module: {
    rules: [
      { test: /\.(jpg|png|gif|jpeg)$/, type: 'asset/resource' },
      {
        test: /\.(js|jsx)$/,
        use: {
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'ecmascript', jsx: true },
              transform: { react: { runtime: 'automatic' } },
            },
          },
        },
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'main_app',
      remotes: {
        'component-app': 'component_app@http://localhost:3001/remoteEntry.js',
        'node-local-remote':
          'node_local_remote@http://localhost:3004/remoteEntry.js',
      },
      shared: {
        react: { singleton: true, requiredVersion: '19.2.3' },
        'react-dom': { singleton: true, requiredVersion: '19.2.3' },
      },
    }),
    new HtmlRspackPlugin({ template: './public/index.html' }),
  ],
};
