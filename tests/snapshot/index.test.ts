import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('test toMatchSnapshot API', () => {
    expect('hello world').toMatchSnapshot();
  });

  it('test toMatchInlineSnapshot API', () => {
    expect('hello world').toMatchInlineSnapshot(`"hello world"`);
    expect({ a: 1, b: 2 }).toMatchInlineSnapshot(`
      {
        "a": 1,
        "b": 2,
      }
    `);
  });
});
