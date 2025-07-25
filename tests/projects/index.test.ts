import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects', () => {
  it('should run projects correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(logs.filter((log) => log.startsWith('['))).toEqual([]);

    // test log print
    expect(
      logs.find((log) => log.includes('packages/node/test/index.test.ts')),
    ).toBeTruthy();
    expect(
      logs.find((log) => log.includes('packages/client/test/App.test.tsx')),
    ).toBeTruthy();
  });
});
