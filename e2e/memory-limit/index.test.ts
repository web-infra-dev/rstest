import {
  cpSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts/';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('pool.memoryLimit', () => {
  it.for([
    {
      name: 'recycles forks at the RSS limit',
      args: ['run', '--pool.memoryLimit', '2'],
      workers: 4,
      metric: 'rss',
    },
    {
      name: 'recycles forks during collection',
      args: ['list', '--pool.memoryLimit', '2'],
      workers: 4,
      metric: 'rss',
    },
    {
      name: 'reuses forks without a limit',
      args: ['run'],
      workers: 1,
      metric: undefined,
    },
    {
      name: 'reuses forks below the limit',
      args: ['run', '--pool.memoryLimit', '100000GB'],
      workers: 1,
      metric: 'rss',
    },
    {
      name: 'ignores the limit for threads',
      args: ['run', '--pool', 'threads', '--pool.memoryLimit', '2'],
      workers: 1,
      metric: undefined,
    },
    {
      name: 'keeps isolated forks single-use',
      args: ['run', '--isolate', 'true', '--pool.memoryLimit', '100000GB'],
      workers: 4,
      metric: undefined,
    },
    ...(['vmForks', 'vmThreads'] as const).flatMap((pool) => [
      {
        name: `samples heap for ${pool} with the default memory limit`,
        args: ['run', '--pool', pool],
        workers: 1,
        metric: 'heapUsed',
      },
      ...(['run', 'list'] as const).map((command) => ({
        name: `recycles a single ${pool} worker during ${command}`,
        args: [command, '--pool', pool, '--pool.memoryLimit', '2'],
        workers: 4,
        metric: 'heapUsed',
      })),
    ]),
  ])('$name', async ({ args, workers, metric }, { onTestFinished }) => {
    const directory = mkdtempSync(join(tmpdir(), 'rstest-memory-limit-'));
    const logPath = join(directory, 'workers.log');
    const memoryLogPath = join(directory, 'memory.log');
    writeFileSync(memoryLogPath, '');
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args,
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(__dirname, 'fixtures'),
          env: {
            RSTEST_MEMLIMIT_LOG: logPath,
            RSTEST_MEMORY_SAMPLE_LOG: memoryLogPath,
            NODE_OPTIONS: `--require=${join(__dirname, 'fixtures/memory-probe.cjs')}`,
          },
        },
      },
    });
    await expectExecSuccess();
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(4);
    const workerIds = new Set(lines.map((line) => line.split('\t')[0]));
    expect(workerIds.size).toBe(workers);
    const samples = readFileSync(memoryLogPath, 'utf8')
      .split('\n')
      .map((line) => line.split('\t'))
      .filter(([id]) => workerIds.has(id))
      .map(([, sampledMetric]) => sampledMetric);
    expect(samples).toEqual(metric ? Array(4).fill(metric) : []);
  });

  it('rejects an invalid forks memory limit', async ({ onTestFinished }) => {
    const { cli, expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--pool.memoryLimit', '5XB'],
      onTestFinished,
      options: { nodeOptions: { cwd: join(__dirname, 'fixtures') } },
    });
    await expectExecFailed();
    expect(cli.stdout + cli.stderr).toContain('Invalid pool.memoryLimit: 5XB');
  });
});

it('recycles forks after a watch rebuild', async ({ onTestFinished }) => {
  const directory = mkdtempSync(join(__dirname, 'fixtures-watch-'));
  cpSync(join(__dirname, 'fixtures'), directory, { recursive: true });
  const logDirectory = mkdtempSync(join(tmpdir(), 'rstest-memory-watch-'));
  const logPath = join(logDirectory, 'workers.log');
  const { cli } = await runRstestCli({
    command: 'rstest',
    args: ['watch', '--pool.memoryLimit', '2'],
    onTestFinished,
    options: {
      nodeOptions: {
        cwd: directory,
        env: { RSTEST_MEMLIMIT_LOG: logPath },
      },
    },
  });
  onTestFinished(async () => {
    await cli.killProcessTree();
    rmSync(directory, { recursive: true, force: true });
    rmSync(logDirectory, { recursive: true, force: true });
  });
  await cli.waitForStdout('Waiting for file changes');
  const initial = readFileSync(logPath, 'utf8').trim().split('\n');
  expect(initial).toHaveLength(4);
  cli.resetStd();
  appendFileSync(
    join(directory, 'test/f1.test.ts'),
    "\nit('watch rebuild', () => { expect(1).toBe(1); });\n",
  );
  await cli.waitForStdout('Waiting for file changes');
  const lines = readFileSync(logPath, 'utf8').trim().split('\n');
  expect(lines).toHaveLength(5);
  expect(new Set(lines.map((line) => line.split('\t')[0])).size).toBe(5);
});
