import { describe, expect, it, rs } from '@rstest/core';
import { fs as memfs } from 'memfs';
import { fs } from './fixtures/getFs';

rs.mock('node:fs/promises', () => {
  return {
    default: {
      ...memfs.promises,
      name: 'memfs',
    },
  };
});

describe('test externals mock', () => {
  it('should external node_modules by default', async () => {
    // @ts-expect-error
    expect(fs.name).toBe('memfs');
  });
});
