import { resolve } from 'node:path';
import type { Configuration, RspackOptions } from '@rspack/core';
import { describe, expect, it, rs } from '@rstest/core';
import { toRstestConfig } from '../src';

rs.mock('@rspack/core', () => ({
  ...rs.requireActual<typeof import('@rspack/core')>('@rspack/core'),
  rspackVersion: '2.1.7',
}));

const generatedCache = {
  type: 'persistent',
  storage: {
    type: 'filesystem',
    directory: '/repo/project/.cache/rstest',
  },
} satisfies NonNullable<Configuration['cache']>;

const applyRspackTool = (
  config: ReturnType<typeof toRstestConfig>,
): Configuration => {
  const rspackTool = config.tools?.rspack as (
    config: Configuration,
    utils: {
      mergeConfig: (
        first: Configuration | Configuration[],
        ...configs: Configuration[]
      ) => Configuration;
    },
  ) => Configuration;

  return rspackTool(
    { cache: generatedCache },
    {
      mergeConfig: (first, ...configs) =>
        Object.assign(
          {},
          ...(Array.isArray(first) ? first : [first]),
          ...configs,
        ),
    },
  );
};

describe('legacy persistent cache', () => {
  it('should preserve storage.directory as the exact cache location', () => {
    const rspackConfig = {
      name: 'client',
      context: '/repo/project',
      cache: {
        type: 'persistent',
        storage: {
          type: 'filesystem',
          directory: '.cache/client',
        },
      },
    } satisfies RspackOptions;
    const config = toRstestConfig({ rspackConfig });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/.cache/client'),
      cacheDigest: undefined,
      buildDependencies: undefined,
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/.cache/client'),
      },
    });
  });

  it('should preserve the default cache location', () => {
    const rspackConfig = {
      name: 'client',
      mode: 'development',
      context: '/repo/project',
      cache: {
        type: 'persistent',
      },
    } satisfies RspackOptions;
    const config = toRstestConfig({ rspackConfig });

    expect(config.performance?.buildCache).toEqual({
      cacheDirectory: resolve('/repo/project/node_modules/.cache/rspack'),
      cacheDigest: undefined,
      buildDependencies: undefined,
    });
    expect(applyRspackTool(config).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve(
          '/repo/project/node_modules/.cache/rspack/client-development',
        ),
      },
    });
  });
});
