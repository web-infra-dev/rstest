/**
 * reference:
 * https://github.com/rspack-contrib/rsbuild-plugin-typed-css-modules/blob/main/src/loader.ts
 * https://github.com/web-infra-dev/rsbuild/blob/a0939d8994589819cc8ddd8982a69a0743a3227a/packages/core/src/loader/ignoreCssLoader.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CSSLoaderOptions, RsbuildPlugin } from '@rsbuild/core';

export const PLUGIN_CSS_FILTER = 'rstest:css-filter';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * When CSS does not need to be emitted, pre-set the CSS content to empty (except for CSS modules) to reduce time costs in less-loader / sass-loader / css-loader.
 */
export const pluginCSSFilter = (): RsbuildPlugin => ({
  name: PLUGIN_CSS_FILTER,

  setup(api) {
    api.modifyBundlerChain({
      order: 'post',
      handler: async (chain, { target, CHAIN_ID, environment }) => {
        const emitCss = environment.config.output.emitCss ?? target === 'web';
        if (!emitCss) {
          const ruleIds = [
            CHAIN_ID.RULE.CSS,
            CHAIN_ID.RULE.SASS,
            CHAIN_ID.RULE.LESS,
            CHAIN_ID.RULE.STYLUS,
          ];

          for (const ruleId of ruleIds) {
            if (!chain.module.rules.has(ruleId)) {
              continue;
            }

            const rule = chain.module.rule(ruleId);

            if (!rule.uses.has(CHAIN_ID.USE.CSS)) {
              continue;
            }

            const cssLoaderOptions: CSSLoaderOptions = rule
              .use(CHAIN_ID.USE.CSS)
              .get('options');

            if (
              !cssLoaderOptions.modules ||
              (typeof cssLoaderOptions.modules === 'object' &&
                cssLoaderOptions.modules.auto === false)
            ) {
              continue;
            }

            rule
              .use('rstest-css-pre-filter')
              .loader(path.join(__dirname, 'cssFilterLoader.mjs'))
              .options({
                modules: cssLoaderOptions.modules,
              })
              .after(ruleId);
          }
        }
      },
    });
  },
});
