import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';

describe('Node API', () => {
  it('should use node path API correctly', async () => {
    expect(
      pathe
        .resolve(__dirname, './index.test.ts')
        .endsWith('basic/test/index.test.ts'),
    ).toBeTruthy();
  });
});
