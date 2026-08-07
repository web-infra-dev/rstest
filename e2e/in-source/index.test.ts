import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('In-Source testing', () => {
  it('should run in-source testing correctly', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--reporter=verbose'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });
    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('Test Files 3 passed')),
    ).toBeTruthy();
    expect(logs.find((log) => log.includes('Tests 3 passed'))).toBeTruthy();
    expect(cli.stdout).toContain(
      'dynamically imports an in-source test module',
    );
    expect(cli.stdout).toContain('statically imports an in-source test module');
    expect(cli.stdout.match(/should test source code correctly/g)).toHaveLength(
      1,
    );
  });
});
