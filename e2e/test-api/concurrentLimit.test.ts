import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

it('should run concurrent cases correctly with limit', async () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', 'fixtures/concurrentLimit.test.ts', '--maxConcurrency=4'],
    options: {
      nodeOptions: {
        cwd: __dirname,
      },
    },
  });
  await expectExecSuccess();

  const logs = cli.stdout
    .split('\n')
    .filter((log) => log.includes('[log]'))
    .map((log) => log.slice(log.indexOf('[log]')));
  const activeCases = new Set<string>();

  for (const log of logs) {
    const match = log.match(/concurrent test (\d+)( - 1)?$/);
    expect(match).not.toBeNull();
    if (!match) continue;

    const caseNumber = match[1];
    const isFinished = match[2];
    if (!caseNumber) continue;
    if (isFinished) {
      expect(activeCases.delete(caseNumber)).toBe(true);
    } else {
      activeCases.add(caseNumber);
      expect(activeCases.size).toBeLessThanOrEqual(4);
    }
  }

  expect(activeCases.size).toBe(0);
  expect(logs).toHaveLength(14);
});
