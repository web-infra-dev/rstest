import { ModuleFederationPlugin } from '@module-federation/enhanced/rspack';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';
import path from 'node:path';

export default defineConfig({
  testEnvironment: 'node',
  plugins: [pluginReact()],
  globalSetup: ['./scripts/rstestGlobalSetup.ts'],
  federation: true,
  // Module Federation's Node runtime may load chunks via `fs` when running in Node.
  // Ensure the test build output is written to disk so those chunks exist.
  dev: {
    writeToDisk: true,
  },
  output: {
    // Module Federation's Node runtime works best with CJS output in our test runner.
    // This also ensures `__rstest_dynamic_import__` is injected as a function argument
    // rather than relying on ESM `import.meta` shims.
    module: false,
  },
  tools: {
    // Enable Rspack-level customization so federated imports like `component-app/Button`
    // can be handled by the Module Federation runtime.
    rspack: (config) => {
      config.target = 'async-node';
      // Rstest's Node-targeted bundling config externalizes many imports.
      // MF injects a loader-style request like:
      //   @module-federation/runtime/rspack.js!=!data:text/javascript,...
      // If that gets treated as external, Node will throw ERR_INVALID_MODULE_SPECIFIER at runtime.
      // Wrap externals functions to never externalize that MF runtime request.
      if (config.externals) {
	        const externalsArr = Array.isArray(config.externals)
	          ? config.externals
	          : [config.externals];

	        config.externals = externalsArr.map((ext) => {
	          if (typeof ext !== 'function') return ext;
	          return (data: any, callback: any) => {
	            const req =
	              typeof data === 'string'
	                ? data
	                : (data && typeof data.request === 'string' ? data.request : undefined);

	            if (
	              typeof req === 'string' &&
	              (req.startsWith('@module-federation/runtime/rspack.js') ||
	                req === '@module-federation/node/runtimePlugin')
	            ) {
	              return callback();
	            }

            // Rstest's node externals currently externalize unresolved specifiers as
            // `node-commonjs` (to support mocks). That breaks Module Federation
            // remotes like `component-app/Button` which must
            // stay bundled so the MF runtime can load them from remoteEntry.js.
            if (
              typeof req === 'string' &&
              (req === 'component-app' ||
                req.startsWith('component-app/'))
            ) {
              return callback();
            }
	            return (ext as any)(data, callback);
	          };
	        });
	      }

      config.output = {
        ...(config.output ?? {}),
        // Avoid hard-coding dev-server URLs for test builds.
        publicPath: 'auto',
      };

      config.plugins ??= [];
	      config.plugins.push(
	        new ModuleFederationPlugin({
	          name: 'main_app',
          library: { type: 'commonjs-module', name: 'main_app' },
	          remoteType: 'script',
	          remotes: {
            // Use a Node-targeted remote build (dist-node, served on 3003).
	            'component-app': 'component_app@http://localhost:3003/remoteEntry.js',
	          },
          // Use a local Node runtime plugin so the example runs without extra deps.
          runtimePlugins: [path.resolve(__dirname, '../runtimePlugin.js')],
          shared: {
            react: { singleton: true, requiredVersion: '17.0.2' },
            'react-dom': { singleton: true, requiredVersion: '17.0.2' },
          },
	        }),
	      );

      return config;
    },
  },
});
