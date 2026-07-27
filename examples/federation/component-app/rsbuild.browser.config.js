const { pluginModuleFederation } = require('@module-federation/rsbuild-plugin');
const { defineConfig } = require('@rsbuild/core');
const { pluginReact } = require('@rsbuild/plugin-react');

module.exports = defineConfig({
  mode: 'development',
  dev: {
    assetPrefix: 'http://localhost:3001/',
  },
  source: {
    entry: {
      index: './index.js',
    },
  },
  output: {
    assetPrefix: 'http://localhost:3001/',
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
      name: 'component_app',
      experiments: {
        asyncStartup: true,
      },
      filename: 'remoteEntry.js',
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
    }),
  ],
});
