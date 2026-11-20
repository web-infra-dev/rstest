import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));
const preload = fileURLToPath(
  new URL('./fixtures/prebundle/fail-prebundle.cjs', import.meta.url),
);

const prebundleCache = (root: string) =>
  path.join(root, 'node_modules/.cache/.rstest-test-environments');

const clearPrebundleCache = (
  root: string,
  onTestFinished: (fn: () => void) => void,
) => {
  fs.rmSync(prebundleCache(root), { recursive: true, force: true });
  onTestFinished(() => {
    fs.rmSync(prebundleCache(root), { recursive: true, force: true });
  });
};

it('includes environment prebundles in the first build duration', async ({
  onTestFinished,
}) => {
  clearPrebundleCache(cwd, onTestFinished);
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
    onTestFinished,
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

describe.for(['jsdom', 'happy-dom'])('%s prebundle cache', (environment) => {
  it('reuses the cached prebundle across runs and keeps it after the run', async () => {
    const target = path.join(
      cwd,
      `../fixtures-test-prebundle-reuse-${environment}`,
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: cwd,
      fixturesTargetPath: target,
    });
    const cacheRoot = prebundleCache(target);
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    const listBundles = () =>
      fs.existsSync(cacheRoot)
        ? fs
            .readdirSync(cacheRoot, { recursive: true })
            .filter((name) => String(name).endsWith('environment.mjs'))
        : [];
    try {
      const logs: string[] = [];
      for (const run of [1, 2]) {
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
              cwd: target,
              env: { DEBUG: 'rstest' },
            },
          },
        });
        await expectExecSuccess();
        logs.push(cli.log);
        expect(listBundles(), `bundles after run ${run}`).toHaveLength(1);
      }
      const [first, second] = logs as [string, string];
      expect(first).toContain('published test environment prebundle');
      expect(first).not.toContain('reusing cached test environment prebundle');
      expect(second).toContain('reusing cached test environment prebundle');
      expect(second).not.toContain('published test environment prebundle');
      if (environment === 'jsdom') {
        expect(second).toContain(
          'Reusing successful bundled jsdom compatibility probe',
        );
      }
      // Neither run leaves a build directory behind.
      expect(
        fs.readdirSync(cacheRoot).filter((name) => name.startsWith('.')),
      ).toEqual([]);
    } finally {
      fixtureFs.delete(target);
    }
  });

  it('shares one cache between processes that prepare the same key at once', async () => {
    const target = path.join(
      cwd,
      `../fixtures-test-prebundle-concurrent-${environment}`,
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: cwd,
      fixturesTargetPath: target,
    });
    const cacheRoot = prebundleCache(target);
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    try {
      // Both processes share the project root (and so the cache key) but not
      // Rstest's own build output.
      for (const id of [1, 2]) {
        fs.writeFileSync(
          path.join(target, `rstest.concurrent-${id}.config.mts`),
          `import config from './rstest.prebundle.config.mts';
export default {
  ...config,
  projects: config.projects.map((project) => ({
    ...project,
    output: { distPath: { root: 'dist-${id}' } },
  })),
};
`,
        );
      }
      const runs = await Promise.all(
        [1, 2].map((id) =>
          runRstestCli({
            command: 'rstest',
            args: [
              'run',
              '--config',
              `rstest.concurrent-${id}.config.mts`,
              '--project',
              environment,
            ],
            options: {
              nodeOptions: {
                cwd: target,
                env: { DEBUG: 'rstest' },
              },
            },
          }),
        ),
      );
      for (const { cli, expectExecSuccess } of runs) {
        await expectExecSuccess();
        // A partial or unreadable entry would force the native fallback.
        expect(cli.log).not.toContain('falling back to its native entry');
        expect(cli.log).toContain('test environment prebundle for');
      }
      const [key] = fs
        .readdirSync(cacheRoot)
        .filter((name) => !name.startsWith('.'));
      const entries = fs.readdirSync(path.join(cacheRoot, key!));
      // One entry per publishing process, each complete.
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.length).toBeLessThanOrEqual(2);
      for (const entry of entries) {
        const directory = path.join(cacheRoot, key!, entry);
        expect(fs.existsSync(path.join(directory, 'manifest.json'))).toBe(true);
        expect(
          fs.existsSync(path.join(directory, 'dist/environment.mjs')),
        ).toBe(true);
        if (environment === 'jsdom') {
          expect(
            fs.existsSync(
              path.join(directory, 'dist/environment.mjs.probe-ok'),
            ),
          ).toBe(true);
        }
      }
      expect(
        fs.readdirSync(cacheRoot).filter((name) => name.startsWith('.')),
      ).toEqual([]);
    } finally {
      fixtureFs.delete(target);
    }
  });
});

describe.for(['jsdom', 'happy-dom'])('%s prebundle fallback', (environment) => {
  it.for(['build', 'load', 'crash'])(
    'keeps the test environment usable after prebundle %s failure',
    async (failure, { onTestFinished }) => {
      // A cached bundle would skip the build the injection targets, and the
      // injected failure itself must not be cached for later tests.
      clearPrebundleCache(cwd, onTestFinished);
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
  clearPrebundleCache(cwd, onTestFinished);
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
  clearPrebundleCache(cwd, onTestFinished);
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
