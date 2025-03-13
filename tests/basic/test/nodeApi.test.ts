import path from 'node:path';
import { describe, expect, it } from '@rstest/core';

describe('Node API', () => {
  it('should use node path API correctly', async () => {
    expect(
      path
        .resolve(__dirname, './index.test.ts')
        .endsWith(path.posix.join('basic', 'test', 'index.test.ts')),
    ).toBeTruthy();
  });
});
