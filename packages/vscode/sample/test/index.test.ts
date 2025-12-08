import { describe, expect, it } from '@rstest/core';
import { sayHi } from '../src/index';

describe('Index', () => {
  it('should add two numbers correctly', () => {
    expect(1 + 1).toBe(2);
  });

  it('should test source code correctly', () => {
    expect(sayHi()).toBe('hi');
  });

  it.each([
    [2, 1, 3],
    [2, 2, 4],
    [3, 1, 4],
  ])('case-%# add(%i, %i) -> %i', (a, b, expected) => {
    expect(a + b).toBe(expected);
  });
});
