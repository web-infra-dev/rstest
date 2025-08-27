import { describe, expect, it } from '@rstest/core';

describe('test snapshot', () => {
  it('should failed when snapshot unmatched', () => {
    let content = '';

    for (let i = 0; i < 101; i++) {
      content += `
    ${i}`;
    }

    expect(content).toMatchSnapshot();
  });
});
