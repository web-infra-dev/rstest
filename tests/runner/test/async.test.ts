import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test Async Suite', () => {
  it('should run async suite in the correct order', async () => {
    const process = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/async.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    const logs = process.stdout.split('\n').filter(Boolean);

    // test execution order
    expect(logs.filter((log) => log.startsWith('run'))).toMatchInlineSnapshot(`
      [
        "run 0-0",
        "run 0-1-0",
        "run 0-1-1-0",
        "run 0-2-0",
        "run 0-3",
        "run 1-0",
        "run 2-0-0",
        "run 2-1",
        "run 3-0",
      ]
    `);

    // test suite reference
    expect(
      logs
        .filter((log) => log.includes('Test Async Suite'))
        // slice `✓ Test Async Suite > 2 > 2-0 > 2-0-0 (0 ms)` to `> 2 > 2-0 > 2-0-0`
        .map((log) => log.split('Test Async Suite')[1].split('(')[0]),
    ).toMatchInlineSnapshot(`
      [
        " > 0 > 0-0 ",
        " > 0 > 0-1 > 0-1-0 ",
        " > 0 > 0-1 > 0-1-1 > 0-1-1-0 ",
        " > 0 > 0-2 > 0-2-0 ",
        " > 0 > 0-3 ",
        " > 1 ",
        " > 2 > 2-0 > 2-0-0 ",
        " > 2 > 2-1 ",
        " > 3 ",
      ]
    `);
  });
});
