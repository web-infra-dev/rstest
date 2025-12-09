import { describe, expect, it } from '@rstest/core';

describe('Index', () => {
  it('test truncateThreshold', () => {
    expect([1, 2, [3, [4], { a: 1, length: 1 }]]).toStrictEqual([1, 2, [3]]);
  });
});
