/**
 * reference:
 * https://github.com/rstackjs/rsbuild-plugin-typed-css-modules/blob/main/src/loader.ts
 * https://github.com/web-infra-dev/rsbuild/blob/a0939d8994589819cc8ddd8982a69a0743a3227a/packages/core/src/loader/ignoreCssLoader.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CSSLoaderOptions, RsbuildPlugin } from '@rsbuild/core';

const PLUGIN_CSS_FILTER = 'rstest:css-filter';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * When CSS does not need to be emitted, pre-set the CSS content to empty (except for CSS modules) to reduce time costs in less-loader / sass-loader / css-loader.
 */
export const pluginCSSFilter = (): RsbuildPlugin => ({
  name: PLUGIN_CSS_FILTER,

  setup(api) {
    api.modifyBundlerChain({
      order: 'post',
      handler: (chain, { target, CHAIN_ID, environment }) => {
        const emitCss = environment.config.output.emitCss ?? target === 'web';
        if (!emitCss) {
          const ruleIds = [
            [CHAIN_ID.RULE.CSS, CHAIN_ID.ONE_OF.CSS_MAIN],
            [CHAIN_ID.RULE.SASS, 'sass'],
            [CHAIN_ID.RULE.LESS, 'less'],
            [CHAIN_ID.RULE.STYLUS, 'stylus'],
          ];

          for (const [ruleId, mainId] of ruleIds) {
            if (!chain.module.rules.has(ruleId!)) {
              continue;
            }

            const rule = chain.module.rule(ruleId!).oneOf(mainId!);

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

            const clonedOptions = {
              ...cssLoaderOptions,
              importLoaders: (cssLoaderOptions.importLoaders || 0) + 1,
            };
            rule.use(CHAIN_ID.USE.CSS).options(clonedOptions);

            rule
              .use('rstest-css-pre-filter')
              .loader(path.join(__dirname, 'cssFilterLoader.mjs'))
              .options({
                modules: cssLoaderOptions.modules,
              })
              .after(mainId!);
          }
        }
      },
    });
  },
});
