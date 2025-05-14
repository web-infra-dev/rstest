import { describe, expect, it } from '@rstest/core';

describe('test b', () => {
  it('test b-1', () => {
    expect(1 + 1).toBe(2);
  });
});

it('test b-2', () => {
  expect(2 - 1).toBe(1);
});
