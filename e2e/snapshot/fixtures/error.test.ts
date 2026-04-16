import { describe, expect, it } from '@rstest/core';

describe('test snapshot - error', () => {
  it('test snapshot generate', () => {
    expect('hello world').toMatchSnapshot();
  });
  it('test snapshot update', () => {
    throw new Error('Intentional Error to prevent snapshot update');
    // expect('hello world1').toMatchSnapshot();
  });
});
