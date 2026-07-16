import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import fs from 'fs-extra';
import { runRstestCli } from '../scripts';

describe('test coverage-v8 include option', () => {
  it('coverage-v8 should be works with include option', async () => {
    const { expectExecSuccess, expectLog, cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', 'date', '-c', 'rstest.include.config.ts'],
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
        },
      },
    });

    await expectExecSuccess();

    const logs = cli.stdout.split('\n').filter(Boolean);
    // test coverage
    expect(
      logs
        .find((log) => log.includes('index.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"index.ts|0|100|0|0|1"`);
    expect(
      logs
        .find((log) => log.includes('date.ts') && log.includes('|'))
        ?.replaceAll(' ', ''),
    ).toMatchInlineSnapshot(`"date.ts|100|100|100|100|"`);

    expect(
      logs.find((log) => log.includes('a.ts') && log.includes('|')),
    ).toBeFalsy();

    expect(
      logs.find((log) => log.includes('b.ts') && log.includes('|')),
    ).toBeFalsy();

    expect(
      logs.find((log) => log.includes('c.ts') && log.includes('|')),
    ).toBeFalsy();

    const coverageSummary: Record<
      string,
      Record<string, { total: number; covered: number }>
    > = fs.readJsonSync(
      join(__dirname, 'fixtures/coverage/coverage-summary.json'),
    );

    expect(
      coverageSummary[join(__dirname, 'fixtures/src/types-only.ts')],
    ).toMatchObject({
      lines: { total: 0, covered: 0 },
      statements: { total: 0, covered: 0 },
      functions: { total: 0, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    expect(
      coverageSummary[join(__dirname, 'fixtures/src/uncovered-mixed.ts')],
    ).toMatchObject({
      lines: { total: 1, covered: 0 },
      statements: { total: 1, covered: 0 },
      functions: { total: 1, covered: 0 },
      branches: { total: 0, covered: 0 },
    });
    expect(
      coverageSummary[join(__dirname, 'fixtures/src/type-assertion.ts')],
    ).toMatchObject({
      lines: { total: 1, covered: 0 },
      statements: { total: 1, covered: 0 },
      functions: { total: 1, covered: 0 },
      branches: { total: 0, covered: 0 },
    });

    expectLog('Test Files 1 passed', logs);
    fs.removeSync(join(__dirname, 'fixtures/coverage'));
  });
});
