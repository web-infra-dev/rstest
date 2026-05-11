import { describe, expect, it } from '@rstest/core';

console.log('shared file log');

describe('shared failing suite', () => {
  console.log('shared suite log');

  it('first failing case', () => {
    console.log('first failing case log');
    expect(1).toBe(2);
  });

  it('second failing case', () => {
    console.log('second failing case log');
    expect(1).toBe(3);
  });
});
