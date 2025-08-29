import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects filter', () => {
  it('should run test success with test file filter', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'client', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    expect(logs.find((log) => log.includes('node/test/index'))).toBeFalsy();
    expect(logs.find((log) => log.includes('client/test/index'))).toBeTruthy();
  });
 
  it('should run test success with project filter', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--project', 'node', '--globals'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    // test log print
    expect(logs.find((log) => log.includes('node/test/index'))).toBeTruthy();
    expect(logs.find((log) => log.includes('client/test/index'))).toBeFalsy();
  });
});
