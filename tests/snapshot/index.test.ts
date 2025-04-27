import path from 'node:path';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { createSnapshotSerializer } from 'path-serializer';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

  it('should failed when use inline snapshot in each', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/inlineSnapshot.each.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;
    expect(cli.exec.process?.exitCode).toBe(1);

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) =>
        log.includes(
          'InlineSnapshot cannot be used inside of test.each or describe.each',
        ),
      ),
    ).toBeTruthy();

    expect(logs.find((log) => log.includes('Tests 6 failed'))).toBeTruthy();
  });
});
