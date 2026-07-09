import { describe, expect, it } from '@rstest/core';

describe('advanced test', () => {
  it('should handle complex operations', () => {
    console.log('Running advanced test...');
    const result = [1, 2, 3].map((x) => x * 2);
    expect(result).toEqual([2, 4, 6]);
  });
});
