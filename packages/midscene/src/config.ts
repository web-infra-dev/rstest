import type { ExtendConfigFn } from '@rstest/core';
import type { PluginMidsceneOptions } from './pluginTypes';

const MIDSCENE_TEST_TIMEOUT_MS = 120_000;
const MIDSCENE_PLUGIN_NAME = 'rstest:midscene';
const MIDSCENE_SUPPORTED_PROVIDER = 'playwright';

type BrowserConfigLike = {
  enabled?: unknown;
  provider?: unknown;
};

const hasMidscenePlugin = (plugins: unknown): boolean => {
  if (!Array.isArray(plugins)) {
    return false;
  }

  return plugins.some((plugin) => {
    return (
      typeof plugin === 'object' &&
      plugin !== null &&
      'name' in plugin &&
      plugin.name === MIDSCENE_PLUGIN_NAME
    );
  });
};

const validateMidsceneBrowserConfig = (browser: unknown): void => {
  const config =
    typeof browser === 'object' && browser !== null
      ? (browser as BrowserConfigLike)
      : undefined;

  if (config?.enabled !== true) {
    throw new Error(
      '@rstest/midscene requires `browser.enabled: true` in `rstest.config.ts`.',
    );
  }

  if (config.provider !== MIDSCENE_SUPPORTED_PROVIDER) {
    throw new Error(
      '@rstest/midscene requires ' +
        `\`browser.provider: '${MIDSCENE_SUPPORTED_PROVIDER}'\` ` +
        'in `rstest.config.ts`.',
    );
  }
};

/**
 * Rstest config adapter for Midscene.
 *
 * Use this in `rstest.config.ts` via `extends` to inject `pluginMidscene()` and
 * raise the default test timeout for AI-driven browser steps.
 */
export function withMidscene(
  options: PluginMidsceneOptions = {},
): ExtendConfigFn {
  const extendConfig: ExtendConfigFn = async (userConfig) => {
    validateMidsceneBrowserConfig(
      (userConfig as { browser?: unknown }).browser,
    );

    const nextConfig = {
      testTimeout: Math.max(
        userConfig.testTimeout ?? 0,
        MIDSCENE_TEST_TIMEOUT_MS,
      ),
    };

    if (hasMidscenePlugin(userConfig.plugins)) {
      return nextConfig;
    }

    const { pluginMidscene } = await import('./plugin.js');

    return {
      ...nextConfig,
      plugins: [pluginMidscene(options)],
    };
  };

  extendConfig.mergeMode = 'append';

  return extendConfig;
}
