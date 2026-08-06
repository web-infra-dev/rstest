import { symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

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

  it.skipIf(process.platform === 'win32')(
    'runs an in-source test discovered through a symlink',
    async () => {
      const fixturesTargetPath = join(
        __dirname,
        'fixtures-test-in-source-symlink',
      );
      const { fs } = await prepareFixtures({
        fixturesPath: join(__dirname, 'fixtures'),
        fixturesTargetPath,
      });

      try {
        await symlink(
          '../linked/symlinked.ts',
          join(fixturesTargetPath, 'src/symlinked.ts'),
          'file',
        );
        const { cli, expectExecSuccess } = await runRstestCli({
          command: 'rstest',
          args: ['run', 'src/symlinked.ts', '--reporter=verbose'],
          options: { nodeOptions: { cwd: fixturesTargetPath } },
        });

        await expectExecSuccess();
        expect(cli.stdout).toContain(
          'runs an in-source test discovered through a symlink',
        );
        expect(cli.stdout).toContain('Test Files 1 passed');
        expect(cli.stdout).toContain('Tests 1 passed');
      } finally {
        fs.delete(fixturesTargetPath);
      }
    },
  );
});
