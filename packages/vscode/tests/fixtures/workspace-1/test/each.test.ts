import { describe, it } from '@rstest/core';

describe('suite', () => {
  it('case', () => {});
});

describe.each([1, 2])('suite %i', (index) => {
  it.each([1, 2])(`suite ${index} case %i`, () => {});
});
