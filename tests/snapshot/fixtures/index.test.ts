import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('test toMatchSnapshot API', () => {
    expect('hello world').toMatchSnapshot();
    expect('hello Rstest').toMatchSnapshot();
  });

  it('test toMatchSnapshot API', () => {
    // test repeat test case name
    expect('hello world 1').toMatchSnapshot();
  });

  it('test toMatchSnapshot API - 1', () => {
    expect('hello world - 1').toMatchSnapshot();
  });

  it('test toMatchSnapshot name', () => {
    expect('hi').toMatchSnapshot('say hi');
  });
});
