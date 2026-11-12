import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = join(dirname(fileURLToPath(import.meta.url)), 'fixtures-quoted');

it.each([
  { filters: ['src/foo.test.ts'], count: 3 },
  { filters: ['SRC/FOO.TEST.TS'], count: 3 },
  { filters: ['pkg/'], count: 1 },
  { filters: [join(cwd, 'pkg')], count: 1 },
  { filters: ['missing', 'foo.test.tsx', 'pkg/'], count: 2 },
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

it('lists files with cwd-relative filters when root differs from cwd', async () => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: ['list', '--filesOnly', '--root', cwd, 'fixtures-quoted/pkg/'],
    options: { nodeOptions: { cwd: dirname(cwd) } },
  });
  await expectExecSuccess();
  expect(cli.stdout.trim()).toBe('pkg/src/foo.test.ts');
});
