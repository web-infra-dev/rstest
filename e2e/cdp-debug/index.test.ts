import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { x } from 'tinyexec';
import { prepareFixtures } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('cdp debug skill', () => {
  it('evaluates locals via CDP', async () => {
    // Keep generated fixture output ignored by git.
    const fixturesTargetPath = `${__dirname}/fixtures-test-cdp-debug-basic`;
    await prepareFixtures({
      fixturesPath: `${__dirname}/fixtures/basic`,
      fixturesTargetPath,
    });

    const build = x('pnpm', ['--filter', '@rstest/cdp-debug', 'build'], {
      nodeOptions: { cwd: path.resolve(__dirname, '../..') },
    });
    await build;
    if (build.process?.exitCode !== 0) {
      throw new Error('Failed to build @rstest/cdp-debug.');
    }

    const profileSourcePath = path.join(fixturesTargetPath, 'src/profile.ts');
    const plan = {
      runner: {
        cmd: 'pnpm',
        args: [
          'rstest',
          'run',
          '-c',
          'rstest.config.ts',
          '--include',
          'test/profile.test.ts',
        ],
        cwd: fixturesTargetPath,
        env: {
          FORCE_COLOR: '0',
        },
      },
      tasks: [
        {
          description: 'Inspect formatted profile fields',
          sourcePath: profileSourcePath,
          line: 7,
          column: 0,
          expressions: ['trimmed', 'normalized', 'displayName', 'role'],
        },
      ],
    };
    const stdinPayload = JSON.stringify(plan, null, 2);

    let stdout = '';
    const cli = x(
      'node',
      [
        path.resolve(
          __dirname,
          '../../packages/skill-cdp-debug/dist/rstest-cdp-debug.cjs',
        ),
        '--plan',
        '-',
        '--debug',
        '1',
      ],
      {
        nodeOptions: {
          cwd: fixturesTargetPath,
        },
      },
    );

    cli.process?.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    cli.process?.stdin?.write(stdinPayload);
    cli.process?.stdin?.end();

    try {
      await Promise.race([
        cli,
        new Promise<void>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('rstest-cdp-debug timed out.')),
            45_000,
          );
        }),
      ]);
    } catch (_error) {
      const details = stdout.trim() ? `\n${stdout}` : '';
      throw new Error(`rstest-cdp-debug failed.${details}`);
    }

    const result = JSON.parse(stdout) as {
      ok: boolean;
      results: Array<{
        id: string;
        values: Array<{ expression: string; value: unknown }>;
      }>;
      meta: {
        forwardedArgs: string[];
        mappingDiagnostics: Array<{ reason: string }>;
        pendingTaskIds: string[];
      };
    };
    if (!result.ok) {
      throw new Error(`rstest-cdp-debug failed.\n${JSON.stringify(result)}`);
    }

    expect(result.ok).toBeTruthy();
    expect(result.meta.pendingTaskIds.length).toBe(0);

    expect(result.meta.forwardedArgs).toContain('--pool.maxWorkers=1');
    expect(result.meta.forwardedArgs).toContain(
      '--pool.execArgv=--inspect-brk=0',
    );

    const profileResult = result.results.find((item) => item.id === 'task-1');
    expect(profileResult).toBeTruthy();
    const values = Object.fromEntries(
      (profileResult?.values || []).map((entry) => [
        entry.expression,
        entry.value,
      ]),
    );
    expect(values.trimmed).toBe('Ada Lovelace');
    expect(values.normalized).toBe('ada-lovelace');
    expect(values.displayName).toBe('Ada Lovelace');
    expect(values.role).toBe('admin');
  }, 60_000);
});
