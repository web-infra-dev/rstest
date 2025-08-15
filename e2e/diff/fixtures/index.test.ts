import { describe, expect, it } from '@rstest/core';

describe('Diff', () => {
  it('diff object', () => {
    expect({
      a: 1,
      b: 2,
      c: {
        cA: 1,
      },
    }).toEqual({
      a: 1,
      b: 3,
      c: {
        cA: 3,
      },
    });
  });

  it('diff string', () => {
    expect('hi').toBe('hii');
  });
});
