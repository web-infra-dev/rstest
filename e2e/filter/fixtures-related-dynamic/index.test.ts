import { describe, expect, it } from '@rstest/core';

describe('index', () => {
  it('should transform late', async () => {
    const { getLate } = await import('./src/late');
    expect(getLate()).toBe('LATE');
  });
});
