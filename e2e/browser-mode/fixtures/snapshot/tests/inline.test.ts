import { describe, expect, it } from '@rstest/core';

describe('browser snapshot - inline', () => {
  it('should match inline snapshot', () => {
    expect('hello').toMatchInlineSnapshot(`"hello"`);
  });

  it('should match object inline snapshot', () => {
    expect({ a: 1, b: 2 }).toMatchInlineSnapshot(`
      {
        "a": 1,
        "b": 2,
      }
    `);
  });

  it('should throw error matching inline snapshot', () => {
    const throwError = () => {
      throw new Error('inline error');
    };
    expect(throwError).toThrowErrorMatchingInlineSnapshot(
      '[Error: inline error]',
    );
  });
});
