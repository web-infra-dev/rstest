import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';

describe('test snapshot', () => {
  it('test toMatchInlineSnapshot API', () => {
    expect('hello world').toMatchInlineSnapshot(`"hello world"`);
    expect({ a: 1, b: 2 }).toMatchInlineSnapshot(`
      {
        "a": 1,
        "b": 2,
      }
    `);
  });

  it('test custom serializer', () => {
    expect.addSnapshotSerializer(
      createSnapshotSerializer({
        workspace: path.join(__dirname, '..'),
      }),
    );
    expect(__filename).toMatchInlineSnapshot(
      `"<WORKSPACE>/snapshot/index.test.ts"`,
    );
  });
});
