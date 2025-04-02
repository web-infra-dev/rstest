import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('test toMatchSnapshot API', () => {
    expect('hello world').toMatchSnapshot();
  });

  it.todo('test toMatchInlineSnapshot API', () => {
    expect('hello world').toMatchInlineSnapshot();
  });
});
