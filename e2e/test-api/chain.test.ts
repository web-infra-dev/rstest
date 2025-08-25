import { describe, expect, it } from '@rstest/core';

describe('Test Chain', () => {
  it('chain API enumerable', async () => {
    expect(Object.keys(it)).toMatchInlineSnapshot(`
      [
        "fails",
        "concurrent",
        "sequential",
        "skip",
        "todo",
        "only",
        "runIf",
        "skipIf",
        "each",
        "for",
        "extend",
      ]
    `);
    expect(Object.keys(it.only)).toMatchInlineSnapshot(`
      [
        "fails",
        "concurrent",
        "sequential",
        "skip",
        "todo",
        "only",
        "runIf",
        "skipIf",
        "each",
        "for",
      ]
    `);
  });
});
