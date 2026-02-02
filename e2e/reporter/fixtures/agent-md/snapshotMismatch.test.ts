import { describe, expect, it } from '@rstest/core';

describe('agent-md', () => {
  it('fails with snapshot mismatch', () => {
    expect({ a: 1 }).toMatchInlineSnapshot(`
      {
        "a": 2,
      }
    `);
  });
});
