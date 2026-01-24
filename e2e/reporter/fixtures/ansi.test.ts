import { describe, expect, it } from '@rstest/core';

describe('ansi snapshot', () => {
  it('shows snapshot diff without ansi', () => {
    const message = 'hi';

    expect(message).toMatchInlineSnapshot('"hi222"');
  });
});
