import type { Rspack } from '@rstest/core';

const castArray = <T>(arr?: T | T[]): T[] => {
  if (arr === undefined) {
    return [];
  }
  return Array.isArray(arr) ? arr : [arr];
};

export const applyDefaultWatchOptions = (
  rspackConfig: Rspack.Configuration,
  isWatchMode: boolean,
) => {
  rspackConfig.watchOptions ??= {};

  if (!isWatchMode) {
    rspackConfig.watchOptions.ignored = '**/**';
    return;
  }

  rspackConfig.watchOptions.ignored = castArray(
    rspackConfig.watchOptions.ignored || [],
  ) as string[];

  if (rspackConfig.watchOptions.ignored.length === 0) {
    rspackConfig.watchOptions.ignored.push('**/.git', '**/node_modules');
  }

  rspackConfig.output?.path &&
    rspackConfig.watchOptions.ignored.push(rspackConfig.output.path);
};
