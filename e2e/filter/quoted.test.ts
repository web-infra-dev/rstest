import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = join(dirname(fileURLToPath(import.meta.url)), 'fixtures-quoted');

it.each([
  { filters: ['src/foo.test.ts'], count: 3 },
  { filters: ['"src/foo.test.ts"'], count: 1 },
  { filters: ["'src/foo.test.ts'"], count: 1 },
  { filters: [`"${join(cwd, 'src/foo.test.ts')}"`], count: 1 },
  { filters: ['"src/foo.test.ts"', 'pkg'], count: 2 },
])('runs $count files for $filters', async ({ filters, count }) => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['run', ...filters],
    options: { nodeOptions: { cwd } },
  });
  await expectExecSuccess();
  expect(cli.stdout).toContain(`Test Files ${count} passed`);
});
