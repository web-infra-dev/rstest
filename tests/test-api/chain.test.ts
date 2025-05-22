import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
