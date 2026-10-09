import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('test snapshot', () => {
  it('should mark snapshot obsolete, but not when the case is skipped', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'fixtures/obsolete.test.ts', 'fixtures/skip.test.ts'],
      options: {
        nodeOptions: {
          cwd: __dirname,
        },
      },
    });

    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'obsolete.test.ts passes').toMatch(
      /✓ fixtures\/obsolete\.test\.ts \(1\)/,
    );
    expect(cli.stdout, 'unused snapshot is listed as obsolete').toMatch(
      /➜ fixtures\/obsolete\.test\.ts$/m,
    );
    expect(cli.stdout, 'skip.test.ts runs with its only case skipped').toMatch(
      /- fixtures\/skip\.test\.ts \(1\)/,
    );
    expect(
      cli.stdout,
      'skipped case does not mark its snapshot obsolete',
    ).not.toMatch(/➜ fixtures\/skip\.test\.ts$/m);
    expect(
      cli.stdout,
      'skipped snapshot does not raise the obsolete count above 1',
    ).toMatch(/Snapshots\s+1 obsolete$/m);
    await expectExecSuccess();
  });
});
