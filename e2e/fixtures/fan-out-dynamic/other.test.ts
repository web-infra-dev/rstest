import { describe, expect, it } from '@rstest/core';

describe('other', () => {
  it('should transform other', async () => {
    const { getOther } = await import('./src/other');
    expect(getOther()).toBe('OTHER');
  });
});
