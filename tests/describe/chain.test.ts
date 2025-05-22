import { describe, expect, it } from '@rstest/core';

it('Describe chain API enumerable', async () => {
  expect(Object.keys(describe)).toMatchInlineSnapshot(`
    [
      "only",
      "todo",
      "skip",
      "concurrent",
      "sequential",
      "skipIf",
      "runIf",
      "each",
      "for",
    ]
  `);
  expect(Object.keys(describe.only)).toMatchInlineSnapshot(`
    [
      "only",
      "todo",
      "skip",
      "concurrent",
      "sequential",
      "skipIf",
      "runIf",
      "each",
      "for",
    ]
  `);
});
