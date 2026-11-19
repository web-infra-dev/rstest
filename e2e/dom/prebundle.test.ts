import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));
const preload = fileURLToPath(
  new URL('./fixtures/prebundle/fail-prebundle.cjs', import.meta.url),
);

it('includes environment prebundles in the first build duration', async () => {
  const start = performance.now();
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '--config',
      'rstest.prebundle.config.mts',
      '--reporters',
      'json',
    ],
    options: { nodeOptions: { cwd } },
  });
  await expectExecSuccess();
  const { durationMs } = JSON.parse(cli.stdout.slice(cli.stdout.indexOf('{')));
  expect(durationMs.prebundle.jsdom).toBeGreaterThan(0);
  expect(durationMs.prebundle['happy-dom']).toBeGreaterThan(0);
  expect(durationMs.build).toBeGreaterThanOrEqual(durationMs.prebundle.jsdom);
  expect(durationMs.build).toBeGreaterThanOrEqual(
    durationMs.prebundle['happy-dom'],
  );
  expect(durationMs.total).toBeGreaterThanOrEqual(durationMs.build);
  expect(durationMs.total).toBeGreaterThanOrEqual(durationMs.tests);
  expect(durationMs.build + durationMs.tests).toBeGreaterThanOrEqual(
    durationMs.total,
  );
  expect(durationMs.total).toBeLessThanOrEqual(performance.now() - start);
});

describe.for(['jsdom', 'happy-dom'])('%s prebundle fallback', (environment) => {
  it.for(['build', 'load', 'crash'])(
    'keeps the test environment usable after prebundle %s failure',
    async (failure, { onTestFinished }) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          'run',
          '--config',
          'rstest.prebundle.config.mts',
          '--project',
          environment,
        ],
        options: {
          nodeOptions: {
            cwd,
            env: {
              PREBUNDLE_FAILURE: failure,
              NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
            },
          },
        },
        onTestFinished,
      });
      await expectExecSuccess();
      expect(cli.log).toContain('falling back to its native entry');
      expect(cli.stdout).toContain('Tests 1 passed');
      if (failure === 'build') expect(cli.log).toContain('Build error');
      if (failure === 'crash') {
        expect(cli.log).toContain(
          `The prebundle process exited with ${process.platform === 'win32' ? 'code 1' : 'SIGKILL'}.`,
        );
      }
    },
  );
});

it('probes the jsdom prebundle once during build instead of inside pool workers', async ({
  onTestFinished,
}) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-jsdom-probe-'));
  const logPath = path.join(tempDir, 'jsdom-pids.log');
  onTestFinished(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '--config',
      'rstest.prebundle.config.mts',
      '--project',
      'jsdom',
    ],
    options: {
      nodeOptions: {
        cwd,
        env: {
          PREBUNDLE_JSDOM_LOG: logPath,
          NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
        },
      },
    },
    onTestFinished,
  });
  await expectExecSuccess();
  expect(cli.stdout).toContain('Tests 1 passed');

  const pids = fs
    .readFileSync(logPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean);
  // One JSDOM instantiation in the disposable prebundle child (compatibility probe)
  // and one in the test worker (test environment setup) — never two in the worker.
  expect(pids).toHaveLength(2);
  expect(new Set(pids).size).toBe(2);
});

it('falls back to native jsdom when the prebundle fails its compatibility probe', async ({
  onTestFinished,
}) => {
  const { cli, expectExecSuccess } = await runRstestCli({
    command: 'rstest',
    args: [
      'run',
      '--config',
      'rstest.prebundle.config.mts',
      '--project',
      'jsdom',
    ],
    options: {
      nodeOptions: {
        cwd,
        env: {
          PREBUNDLE_FAILURE: 'probe',
          NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
        },
      },
    },
    onTestFinished,
  });
  await expectExecSuccess();
  expect(cli.log).toContain('falling back to its native entry');
  expect(cli.log).toContain('injected prebundle probe failure');
  expect(cli.stdout).toContain('Tests 1 passed');
});
