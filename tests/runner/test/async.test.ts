import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { getTestName, runRstestCli } from '../../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Test Async Suite', () => {
  it('should run async suite in the correct order', async () => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/async.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    await cli.exec;

    const logs = cli.stdout.split('\n').filter(Boolean);

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
  });
});
