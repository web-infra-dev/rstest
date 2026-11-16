import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));

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
  expect(durationMs.total).toBe(durationMs.build + durationMs.tests);
  expect(durationMs.total).toBeLessThanOrEqual(performance.now() - start);
});

describe.for(['jsdom', 'happy-dom'])('%s prebundle fallback', (environment) => {
  it.for(['build', 'load', 'crash'])(
    'keeps the test environment usable after prebundle %s failure',
    async (failure, { onTestFinished }) => {
      const preload = fileURLToPath(
        new URL('./fixtures/prebundle/fail-prebundle.cjs', import.meta.url),
      );
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
