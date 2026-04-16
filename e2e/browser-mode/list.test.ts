import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import pathe from 'pathe';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('browser mode - list (collect mode)', () => {
  it('should list browser tests without executing them', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['list'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures', 'list'),
        },
      },
    });

    await expectExecSuccess();

    const lines = cli.stdout
      .split('\n')
      .filter(Boolean)
      .map((l) => pathe.normalize(l));

    // Basic sanity: list should include our browser test cases
    expect(lines.join('\n')).toContain(
      'tests/a.test.ts > browser list > should include this test in list',
    );
    expect(lines.join('\n')).toContain(
      'tests/b.test.ts > browser list nested > nested > should include nested test',
    );

    // Skip/todo tests should not be listed
    expect(lines.join('\n')).not.toContain('should NOT be listed (skip)');
    expect(lines.join('\n')).not.toContain('should NOT be listed (todo)');
  });
});
