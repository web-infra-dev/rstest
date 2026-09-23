import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, onTestFinished } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures', import.meta.url));

async function run(env: Record<string, string> = {}, args: string[] = []) {
  const started = Date.now();
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['run', ...args],
    options: {
      nodeOptions: {
        cwd,
        env: {
          EXIT_TIMEOUT: undefined,
          LEAK_SOCKET: undefined,
          FAIL_TEST: undefined,
          LARGE_OUTPUT: undefined,
          TEARDOWN_MARKER: undefined,
          ...env,
        },
      },
    },
  });
  const timeout = setTimeout(() => {
    void cli.killProcessTree();
  }, 30_000);
  onTestFinished(() => clearTimeout(timeout));
  try {
    await cli.exec;
    await cli.waitForStreamsEnd();
  } finally {
    clearTimeout(timeout);
  }
  expect(cli.exec.process?.signalCode).toBeNull();
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(cli.stdout).toContain('REPORTER_EXIT_DONE');
  return cli;
}

it.each([false, true])(
  'exits a leaking reporter and preserves failure=%s',
  async (fail) => {
    const cli = await run({
      LEAK_SOCKET: 'true',
      EXIT_TIMEOUT: '300',
      FAIL_TEST: String(fail),
    });
    expect(cli.exec.process?.exitCode).toBe(fail ? 1 : 0);
    expect(cli.stderr.match(/The process did not exit 300ms/g)).toHaveLength(1);
  },
);

it('lets CLI zero override config and exits a leak without warning', async () => {
  const cli = await run({ LEAK_SOCKET: 'true', EXIT_TIMEOUT: '10000' }, [
    '--teardownTimeout=0',
  ]);
  expect(cli.exec.process?.exitCode).toBe(0);
  expect(cli.stderr).not.toContain('The process did not exit');
});

it('exits naturally with the default timeout and no leak', async () => {
  const cli = await run();
  expect(cli.exec.process?.exitCode).toBe(0);
  expect(cli.stderr).not.toContain('The process did not exit');
});

it('awaits global teardown before immediate exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rstest-teardown-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, 'done');
  const cli = await run({ EXIT_TIMEOUT: '0', TEARDOWN_MARKER: marker });
  expect(cli.exec.process?.exitCode).toBe(0);
  expect(await readFile(marker, 'utf8')).toBe('teardown finished');
});

it('flushes every line of large piped reporter output before immediate exit', async () => {
  const cli = await run({ EXIT_TIMEOUT: '0', LARGE_OUTPUT: 'true' });
  expect(cli.exec.process?.exitCode).toBe(0);
  const lines = cli.stdout
    .split('\n')
    .filter((line) => line.startsWith('OUTPUT:'));
  expect(lines).toHaveLength(1024);
  for (let index = 0; index < 1024; index++) {
    expect(lines[index]).toBe(`OUTPUT:${index}:${'x'.repeat(1024)}`);
  }
});
