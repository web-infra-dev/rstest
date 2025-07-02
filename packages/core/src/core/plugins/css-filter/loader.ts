/**
 * reference:
 * https://github.com/rspack-contrib/rsbuild-plugin-typed-css-modules/blob/main/src/loader.ts
 * https://github.com/web-infra-dev/rsbuild/blob/a0939d8994589819cc8ddd8982a69a0743a3227a/packages/core/src/loader/ignoreCssLoader.ts
 */
import type { CSSModules, Rspack } from '@rsbuild/core';

type CssLoaderModules =
  | boolean
  | string
  | Required<Pick<CSSModules, 'auto' | 'namedExport'>>;

const CSS_MODULES_REGEX = /\.module\.\w+$/i;

const isCSSModules = ({
  resourcePath,
  resourceQuery,
  resourceFragment,
  modules,
}: {
  resourcePath: string;
  resourceQuery: string;
  resourceFragment: string;
  modules: CssLoaderModules;
}): boolean => {
  if (typeof modules === 'boolean') {
    return modules;
  }

  // Same as the `mode` option
  // https://github.com/webpack-contrib/css-loader?tab=readme-ov-file#mode
  if (typeof modules === 'string') {
    // CSS Modules will be disabled if mode is 'global'
    return modules !== 'global';
  }

  const { auto } = modules;

  if (typeof auto === 'boolean') {
    return auto && CSS_MODULES_REGEX.test(resourcePath);
  }
  if (auto instanceof RegExp) {
    return auto.test(resourcePath);
  }
  if (typeof auto === 'function') {
    return auto(resourcePath, resourceQuery, resourceFragment);
  }
  return true;
};

export default function (
  this: Rspack.LoaderContext<{
    mode: string;
    modules: CssLoaderModules;
  }>,
  content: string,
): string {
  const { resourcePath, resourceQuery, resourceFragment } = this;
  const { modules = true } = this.getOptions() || {};

  if (
    isCSSModules({ resourcePath, resourceQuery, resourceFragment, modules })
  ) {
    return content;
  }

  return '';
}
