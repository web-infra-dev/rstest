import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('should failed when snapshot unmatched', () => {
    expect('hello world!').toMatchSnapshot();
  });
});
