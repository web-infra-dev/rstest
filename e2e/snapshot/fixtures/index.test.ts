import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('test snapshot generate', () => {
    expect('hello world').toMatchSnapshot();
  });
});
