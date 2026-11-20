import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/rss',
);
const rstestBin = fileURLToPath(
  new URL('../../packages/core/bin/rstest.js', import.meta.url),
);

type RssRecord = {
  event: string;
  name?: string;
  project?: string;
  role: 'host' | 'worker';
  pid: number;
  threadId: number;
  workerId: number;
  rssScope: string;
  sampledAt: number;
  testPath?: string;
  pool: string;
  rss: number;
  heapUsed: number;
  outputPath: string;
  assetCount: number;
  jsBytes: number;
  sourceMapBytes: number;
  otherBytes: number;
  totalBytes: number;
  unavailableAssetCount: number;
};

const readRecords = async (path: string): Promise<RssRecord[]> =>
  (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('experimental memory diagnostics', () => {
  it('streams host memory without enabling the Perfetto trace', async () => {
    await rm(join(fixtureRoot, '.rstest'), { recursive: true, force: true });
    await rm(join(fixtureRoot, 'dist'), { recursive: true, force: true });
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--dev.writeToDisk'],
      options: {
        nodeOptions: {
          cwd: fixtureRoot,
          env: { DEBUG: 'rstest:memory', TRACE_RSS_PROJECTS: '1' },
        },
      },
    });
    await expectExecSuccess();
    const path = cli.stdout.match(/RSS trace file: (.+\.jsonl)/)?.[1];
    expect(path).toBeTruthy();
    const records = await readRecords(path!);
    expect(records[0]?.event).toBe('start');
    expect(records.at(-1)?.event).toBe('stop');
    expect(records.some((r) => r.event === 'compile:start' && r.project)).toBe(
      true,
    );
    expect(records.some((r) => r.event === 'compile:end')).toBe(true);
    expect(records.some((r) => r.name === 'host:pool-run-test')).toBe(true);
    expect(
      records
        .filter((r) => r.event !== 'worker:exit')
        .every((r) => r.rss > 0 && r.heapUsed > 0),
    ).toBe(true);
    const projects = records.filter((r) => r.event === 'project:assets');
    expect(projects.map((r) => r.project).sort()).toEqual(['first', 'second']);
    for (const project of projects) {
      const files = await readdir(project.outputPath, { recursive: true });
      let totalBytes = 0;
      let sourceMapBytes = 0;
      let fileCount = 0;
      for (const file of files) {
        const info = await stat(join(project.outputPath, file));
        if (!info.isFile()) continue;
        fileCount++;
        totalBytes += info.size;
        if (file.endsWith('.map')) sourceMapBytes += info.size;
      }
      expect(project.totalBytes).toBe(totalBytes);
      expect(project.sourceMapBytes).toBe(sourceMapBytes);
      expect(project.assetCount).toBe(fileCount);
      expect(project.jsBytes).toBeGreaterThan(0);
      expect(project.sourceMapBytes).toBeGreaterThan(0);
      expect(project.otherBytes).toBeGreaterThan(0);
      expect(
        project.jsBytes + project.sourceMapBytes + project.otherBytes,
      ).toBe(project.totalBytes);
      expect(project.unavailableAssetCount).toBe(0);
    }
    expect(await readdir(join(fixtureRoot, '.rstest'))).toEqual([
      path!.split(/[/\\]/).at(-1),
    ]);
  });

  it.each(['forks', 'threads', 'vmForks', 'vmThreads'])(
    'records periodic and per-task memory for reused %s workers',
    async (pool) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--pool.type',
          pool,
          '--pool.maxWorkers',
          '1',
          '--isolate',
          'false',
        ],
        options: {
          nodeOptions: {
            cwd: fixtureRoot,
            env: {
              DEBUG: 'unrelated,rstest:memory',
              TRACE_RSS_PERIODIC: '1',
            },
          },
        },
      });
      await expectExecSuccess();
      const path = cli.stdout.match(/RSS trace file: (.+\.jsonl)/)?.[1];
      expect(path).toBeTruthy();
      const records = await readRecords(path!);
      const host = records.find((r) => r.role === 'host')!;
      const workers = records.filter((r) => r.role === 'worker');
      const samples = workers.filter((r) => r.event !== 'worker:exit');
      expect(samples.every((r) => r.rss > 0 && r.heapUsed > 0)).toBe(true);
      expect(
        samples.some(
          (r) =>
            r.event === 'worker:sample' &&
            r.testPath?.endsWith('basic.test.ts'),
        ),
      ).toBe(true);
      expect(new Set(workers.map((r) => r.workerId))).toEqual(new Set([1]));
      expect(
        new Set(
          samples
            .filter((r) => r.event === 'worker:task:start')
            .map((r) => r.testPath?.split(/[/\\]/).at(-1)),
        ),
      ).toEqual(new Set(['basic.test.ts', 'reuse.test.ts']));
      expect(workers.filter((r) => r.event === 'worker:exit')).toHaveLength(1);
      expect(
        samples.every(
          (r) => r.pool === pool && r.sampledAt > 1_700_000_000_000,
        ),
      ).toBe(true);
      if (pool === 'forks' || pool === 'vmForks') {
        expect(
          samples.every(
            (r) =>
              r.pid !== host.pid &&
              r.threadId === 0 &&
              r.rssScope === 'worker-process',
          ),
        ).toBe(true);
      } else {
        expect(
          samples.every(
            (r) =>
              r.pid === host.pid &&
              r.threadId > 0 &&
              r.rssScope === 'shared-process',
          ),
        ).toBe(true);
      }
    },
  );

  it('does not enable verbose logging or disk output', async () => {
    await rm(join(fixtureRoot, '.rstest'), { recursive: true, force: true });
    await rm(join(fixtureRoot, 'dist'), { recursive: true, force: true });
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      options: {
        nodeOptions: { cwd: fixtureRoot, env: { DEBUG: 'rstest:memory' } },
      },
    });
    await expectExecSuccess();
    expect(cli.stdout).toContain('RSS trace file:');
    expect(cli.stdout).not.toContain('lifecycle: start');
    await expect(stat(join(fixtureRoot, 'dist'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each(['', 'rstest', '*', 'rstest:memory-extra'])(
    'does not collect memory with DEBUG=%j',
    async (debug) => {
      await rm(join(fixtureRoot, '.rstest'), { recursive: true, force: true });
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run'],
        options: {
          nodeOptions: { cwd: fixtureRoot, env: { DEBUG: debug } },
        },
      });
      await expectExecSuccess();
      expect(cli.stdout).not.toContain('RSS trace file:');
      await expect(readdir(join(fixtureRoot, '.rstest'))).rejects.toMatchObject(
        {
          code: 'ENOENT',
        },
      );
    },
  );

  it('does not expose a CLI memory option', async () => {
    const help = await runRstestCli({
      command: 'rstest',
      args: ['run', '--help'],
      options: { nodeOptions: { cwd: fixtureRoot } },
    });
    await help.expectExecSuccess();
    expect(help.cli.stdout).not.toContain('--trace-rss');
    const removedOption = await runRstestCli({
      command: 'rstest',
      args: ['run', '--trace-rss'],
      options: { nodeOptions: { cwd: fixtureRoot } },
    });
    await removedOption.expectExecFailed();
    expect(removedOption.cli.log).toContain('Unknown option');
  });

  it.each(['sample', 'close', 'write-close'])(
    'preserves successful tests after a diagnostic %s failure',
    async (failure) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: process.execPath,
        args: [
          '--require',
          join(fixtureRoot, 'memory-fault.cjs'),
          rstestBin,
          'run',
        ],
        options: {
          nodeOptions: {
            cwd: fixtureRoot,
            env: { DEBUG: 'rstest:memory', TRACE_RSS_FAILURE: failure },
          },
        },
      });
      await expectExecSuccess();
      expect(cli.stdout).toMatch(/Tests\s+2 passed/);
      expect(cli.log).toContain('injected memory');
      if (failure === 'write-close') {
        expect(cli.log).toContain('injected memory trace write failure');
      }
    },
  );

  it('preserves successful tests after a worker sampler failure', async () => {
    const { cli, expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'run',
        '--pool.type=forks',
        `--pool.execArgv=--require=${join(fixtureRoot, 'memory-fault.cjs')}`,
      ],
      options: {
        nodeOptions: {
          cwd: fixtureRoot,
          env: { DEBUG: 'rstest:memory', TRACE_RSS_FAILURE: 'worker-sample' },
        },
      },
    });
    await expectExecSuccess();
    expect(cli.stdout).toMatch(/Tests\s+2 passed/);
  });

  it.each(['compile', 'tests', 'coverage'])(
    'preserves context after a kill during %s',
    async (stage) => {
      const { cli } = await runRstestCli({
        // On Windows, the rstest.cmd launcher has a different PID from Node.
        command: process.execPath,
        args: [rstestBin, 'run'],
        options: {
          nodeOptions: {
            cwd: fixtureRoot,
            env: { DEBUG: 'rstest:memory', TRACE_RSS_STAGE: stage },
          },
        },
      });
      try {
        await cli.waitForStdout(`BLOCKED:${stage}`);
        const path = cli.stdout.match(/RSS trace file: (.+\.jsonl)/)?.[1];
        expect(path).toBeTruthy();
        if (stage === 'tests') {
          await expect
            .poll(async () =>
              (await readRecords(path!)).some((r) => r.event === 'sample'),
            )
            .toBe(true);
        }
        await cli.killProcessTree();
        const records = await readRecords(path!);
        expect(records.every((r) => r.pid === cli.exec.process?.pid)).toBe(
          true,
        );
        expect(records.at(-1)?.event).not.toBe('stop');
        if (stage === 'compile') {
          expect(records.some((r) => r.event === 'compile:start')).toBe(true);
          expect(records.some((r) => r.event === 'compile:end')).toBe(false);
        } else if (stage === 'coverage') {
          for (const name of ['coverage:merge-maps', 'coverage:clone-map']) {
            expect(
              records.filter((r) => r.name === name).map((r) => r.event),
            ).toEqual(['span:start', 'span:end']);
          }
          expect(
            records.some(
              (r) =>
                r.name === 'coverage:generate-reports' &&
                r.event === 'span:start',
            ),
          ).toBe(true);
          expect(
            records.some(
              (r) =>
                r.name === 'coverage:generate-reports' &&
                r.event === 'span:end',
            ),
          ).toBe(false);
        } else {
          expect(
            records.some(
              (r) =>
                r.name === 'host:pool-run-test' && r.event === 'span:start',
            ),
          ).toBe(true);
          const assets = records.find((r) => r.event === 'project:assets');
          expect(assets?.sourceMapBytes).toBeGreaterThan(0);
          expect(assets?.unavailableAssetCount).toBe(0);
        }
      } finally {
        await cli.killProcessTree();
      }
    },
  );
});
