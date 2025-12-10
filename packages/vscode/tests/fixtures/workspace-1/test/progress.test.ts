import { afterAll, describe, expect, it } from '@rstest/core';

afterAll(() => {
  throw new Error('after root suite');
});

describe('s1', () => {
  afterAll(() => {
    throw new Error('after suite');
  });

  it('should pass', () => {
    expect(1).equal(1);
  });
  it('should mismatch number', () => {
    expect(1).equal(2);
  });
  it('should mismatch object', () => {
    expect({ a: 1 }).equal({ b: 1 });
  });
  it('should mismatch inline snapshot', () => {
    expect('hello').toMatchInlineSnapshot(`"world"`);
  });
  it.skip('should skipped', () => {});
});
