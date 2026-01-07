const { ModuleFederationPlugin } = require('@module-federation/enhanced/rspack');
const path = require('path');

/**
 * Node-targeted remote build used by Rstest's Module Federation test.
 * This differs from the browser build (rspack.config.js):
 * - target: async-node
 * - includes a Node runtime plugin so remote chunks can be loaded over HTTP
 * - outputs to dist-node (served on a separate port from the browser remote)
 */
module.exports = {
  entry: './index.js',
  mode: 'development',
  devtool: 'hidden-source-map',
  target: 'async-node',
  output: {
    // The Node remote runtime resolves chunk URLs relative to the remoteEntry URL
    // when publicPath is explicitly set. `auto` can throw in non-browser contexts.
    publicPath: 'http://localhost:3003/',
    clean: true,
    path: path.resolve(__dirname, 'dist-node'),
  },
  resolve: {
    extensions: ['.jsx', '.js', '.json', '.wasm'],
  },
  experiments: {
    css: true,
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
              parser: {
                syntax: 'ecmascript',
                jsx: true,
              },
              transform: {
                react: {
                  runtime: 'automatic',
                },
              },
            },
          },
        },
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'component_app',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module' },
      // Required for async-node remotes that load chunks over HTTP in Node.
      runtimePlugins: [path.resolve(__dirname, '../runtimePlugin.js')],
      exposes: {
        './Button': './src/Button.jsx',
        './Dialog': './src/Dialog.jsx',
        './Logo': './src/Logo.jsx',
        './ToolTip': './src/ToolTip.jsx',
      },
    }),
  ],
};
