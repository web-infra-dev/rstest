import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('test snapshot generate', () => {
    expect({
      a: 1,
      b: [1, 2, 3],
      c: {
        d: 'hello',
      },
    }).toMatchSnapshot();
  });
});
