const {
  ModuleFederationPlugin,
} = require('@module-federation/enhanced/rspack');

module.exports = {
  entry: './index.js',
  mode: 'development',
  devtool: 'hidden-source-map',
  target: 'async-node',
  output: {
    publicPath: 'http://localhost:3002/',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.(jpg|png|gif|jpeg)$/,
        type: 'asset/resource',
      },
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
      library: { type: 'commonjs-module', name: 'main_app_web' },
      remoteType: 'script',
      remotes: {
        'component-app': 'component_app@http://localhost:3003/remoteEntry.js',
        'node-local-remote':
          'commonjs ../../node-local-remote/dist-node/remoteEntry.js',
      },
      runtimePlugins: ['@module-federation/node/runtimePlugin'],
      shared: {
        react: { singleton: true, requiredVersion: '19.2.3' },
        'react-dom': { singleton: true, requiredVersion: '19.2.3' },
      },
    }),
  ],
};
