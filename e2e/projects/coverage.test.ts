import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test projects coverage', () => {
  it('should run projects correctly with coverage', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--globals', '-c', 'rstest.coverage.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();
    const logs = cli.stdout.split('\n').filter(Boolean);

    expect(
      logs.find((log) => log.includes('All files'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"Allfiles|100|100|100|100|"`);

    expect(
      logs.find((log) => log.includes('client/src'))?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"client/src|100|100|100|100|"`);

    expect(
      logs.find(
        (log) =>
          log.includes('node') &&
          log.replaceAll(' ', '').includes('100|100|100|100'),
      ),
    ).toBeTruthy();

    expect(
      fs.existsSync(join(__dirname, 'fixtures/coverage/index.html')),
    ).toBeTruthy();
  });
});
