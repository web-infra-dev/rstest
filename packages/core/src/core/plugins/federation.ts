import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';

function patchFederationPluginOptions(config: Rspack.Configuration) {
  const plugins = config.plugins;
  if (!Array.isArray(plugins)) return;

  for (const plugin of plugins) {
    // `@module-federation/enhanced/rspack` exposes its options on a private field
    // when used with Rspack. We avoid importing the package here and instead
    // patch the shape that the plugin instance uses at runtime.
    const obj = plugin as unknown as { _options?: unknown; options?: unknown };
    const opts =
      plugin && typeof plugin === 'object'
        ? (obj._options ?? obj.options)
        : null;

    if (!opts || typeof opts !== 'object') continue;

    // Heuristic: MF plugin always has `name` plus `remotes`/`exposes`/`shared`.
    if (!('name' in opts) || (!('remotes' in opts) && !('exposes' in opts))) {
      continue;
    }

    const shared = (opts as any).shared;
    if (!shared || typeof shared !== 'object') continue;

    // MF's runtime uses `loadShareSync` for initial consumes; if a shared module
    // is not eager, MF may generate an async fallback chunk which then crashes
    // in Node with RUNTIME-006. Default shared items to eager unless explicitly
    // set by the user.
    for (const key of Object.keys(shared)) {
      const val = shared[key];
      if (!val || typeof val !== 'object') continue;
      if (val.eager == null) {
        val.eager = true;
      }
    }
  }
}

export const pluginFederationCompat: (context: RstestContext) => RsbuildPlugin =
  (context) => ({
    name: 'rstest:federation-compat',
    setup: (api) => {
      api.modifyRspackConfig(async (config, { environment }) => {
        const project = context.projects.find(
          (p) => p.environmentName === environment.name,
        );
        if (!project?.normalizedConfig.federation) return;
        if (project.normalizedConfig.testEnvironment.name !== 'node') return;

        // Rsbuild doesn't model `async-node`, but Rspack does. MF's Node runtime
        // relies on it to load remote chunks over the network.
        config.target = 'async-node';

        // Keep node builds in a single chunk to avoid MF generating async
        // fallback chunks for `loadShareSync` initial consumes.
        config.optimization ??= {};
        config.optimization.splitChunks = false;

        patchFederationPluginOptions(config);
      });
    },
  });
