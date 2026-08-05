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
    const rspackTool = config.tools?.rspack as (
      config: Configuration,
    ) => Configuration;

    expect(rspackTool({ cache: generatedCache }).cache).toEqual({
      ...generatedCache,
      storage: {
        ...generatedCache.storage,
        location: resolve('/repo/project/.cache/client'),
      },
    });
  });
});
