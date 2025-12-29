import { describe, expect, it } from '@rstest/core';

describe('browser snapshot - inline update', () => {
  it('should update inline snapshot', () => {
    expect('original').toMatchInlineSnapshot();
  });
});
