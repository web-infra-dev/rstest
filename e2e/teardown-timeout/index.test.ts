import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures', import.meta.url));

async function run(env: Record<string, string> = {}, args: string[] = []) {
  const result = await runRstestCli({
    command: 'rstest',
    args: ['run', ...args],
    options: {
      nodeOptions: {
        cwd,
        env,
      },
    },
  });
  const { cli } = result;
  await cli.exec;
  await cli.waitForStreamsEnd();
  expect(cli.exec.process?.signalCode).toBeNull();
  expect(cli.stdout).toContain('REPORTER_EXIT_DONE');
  return result;
}

it.each([false, true])(
  'exits a leaking reporter and preserves failure=%s',
  async (fail) => {
    const { cli, expectExecSuccess } = await run({
      LEAK_SOCKET: 'true',
      EXIT_TIMEOUT: '300',
      FAIL_TEST: String(fail),
    });
    if (fail) {
      expect(cli.exec.process?.exitCode).toBe(1);
    } else {
      await expectExecSuccess();
    }
    expect(cli.stderr.match(/The process did not exit 300ms/g)).toHaveLength(1);
  },
);

it('lets CLI zero override config and exits a leak without warning', async () => {
  const { cli, expectExecSuccess } = await run(
    { LEAK_SOCKET: 'true', EXIT_TIMEOUT: '10000' },
    ['--teardownTimeout=0'],
  );
  await expectExecSuccess();
  expect(cli.stderr).not.toContain('The process did not exit');
});

it('exits naturally with the default timeout and no leak', async () => {
  const { cli, expectExecSuccess } = await run();
  await expectExecSuccess();
  expect(cli.stderr).not.toContain('The process did not exit');
});

it('exits naturally with Infinity and no leak', async () => {
  const { cli, expectExecSuccess } = await run({ EXIT_TIMEOUT: 'Infinity' });
  await expectExecSuccess();
  expect(cli.stderr).not.toContain('The process did not exit');
  expect(cli.stderr).not.toContain('TimeoutOverflowWarning');
});

it.each([false, true])(
  'keeps a leaking reporter alive with Infinity from CLI=%s',
  async (fromCli) => {
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: ['run', ...(fromCli ? ['--teardownTimeout', 'Infinity'] : [])],
      options: {
        nodeOptions: {
          cwd,
          env: {
            LEAK_SOCKET: 'true',
            EXIT_TIMEOUT: fromCli ? '300' : 'Infinity',
          },
        },
      },
    });
    await cli.waitForStdout('REPORTER_EXIT_DONE');
    await setTimeout(1500);
    expect(cli.exec.process?.exitCode).toBeNull();
    expect(cli.exec.process?.signalCode).toBeNull();
    expect(cli.stderr).not.toContain('The process did not exit');
    expect(cli.stderr).not.toContain('TimeoutOverflowWarning');
    await cli.killProcessTree();
  },
);

it('awaits global teardown and flushes large piped output before immediate exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rstest-teardown-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'done');
  const { cli, expectExecSuccess } = await run({
    EXIT_TIMEOUT: '0',
    TEARDOWN_MARKER: marker,
    LARGE_OUTPUT: 'true',
  });
  await expectExecSuccess();
  expect(await readFile(marker, 'utf8')).toBe('teardown finished');
  const lines = cli.stdout
    .split('\n')
    .filter((line) => line.startsWith('OUTPUT:'));
  expect(lines).toHaveLength(1024);
  expect(lines).toEqual(
    Array.from({ length: 1024 }, (_, i) => `OUTPUT:${i}:${'x'.repeat(1024)}`),
  );
});
