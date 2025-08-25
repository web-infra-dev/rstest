import { describe, expect, it } from '@rstest/core';

describe('test a', () => {
  it('test a-1', () => {
    expect(1 + 1).toBe(2);
  });
});

it('test a-2', () => {
  expect(2 - 1).toBe(1);
});
