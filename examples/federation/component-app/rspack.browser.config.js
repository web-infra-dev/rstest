const { HtmlRspackPlugin } = require('@rspack/core');
const {
  ModuleFederationPlugin,
} = require('@module-federation/enhanced/rspack');

module.exports = {
  entry: './index.js',
  mode: 'development',
  devtool: 'hidden-source-map',
  output: {
    publicPath: 'http://localhost:3001/',
    clean: true,
  },
  resolve: {
    extensions: ['.jsx', '.js', '.json', '.wasm'],
  },
  experiments: {
    css: true,
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
      name: 'component_app',
      filename: 'remoteEntry.js',
      library: { type: 'commonjs-module' },
      exposes: {
        './Button': './src/Button.jsx',
        './Dialog': './src/Dialog.jsx',
        './Logo': './src/Logo.jsx',
        './ToolTip': './src/ToolTip.jsx',
      },
    }),
    new HtmlRspackPlugin({ template: './public/index.html' }),
  ],
};
