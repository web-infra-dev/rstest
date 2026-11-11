import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));

describe.for(['jsdom', 'happy-dom'])('%s prebundle bridge', (environment) => {
  it('restores bridge requirements from the persistent build cache', async () => {
    const target = path.join(
      cwd,
      `../fixtures-test-prebundle-cache-${environment}`,
    );
    const { fs } = await prepareFixtures({
      fixturesPath: cwd,
      fixturesTargetPath: target,
    });
    fs.update(path.join(target, 'rstest.demand.config.mts'), (content) =>
      content.replace(
        '...shared,',
        `...shared,
    performance: { buildCache: { cacheDirectory: '.cache/environment-bridge' } },
    plugins: [{ name: 'count-builds', setup(api) {
      api.modifyRspackConfig((config) => { config.plugins.push({ apply(compiler) {
        let built = 0;
        compiler.hooks.compilation.tap('count-builds', (compilation) => {
          compilation.hooks.buildModule.tap('count-builds', () => built++);
        });
        compiler.hooks.done.tap('count-builds', () => console.log('built modules:', built));
      }}); });
    }}],`,
      ),
    );
    try {
      for (const warm of [false, true]) {
        const { cli, expectExecSuccess } = await runRstestCli({
          command: 'rstest',
          args: ['run', '--config', 'rstest.demand.config.mts'],
          options: {
            nodeOptions: {
              cwd: target,
              env: { PREBUNDLE_ENVIRONMENT: environment },
            },
          },
        });
        await expectExecSuccess();
        if (warm) expect(cli.stdout).toContain('built modules: 0');
        else expect(cli.stdout).not.toContain('built modules: 0');
      }
    } finally {
      fs.delete(target);
    }
  });

  it('updates bridge requirements when watch imports are added and removed', async () => {
    const target = path.join(
      cwd,
      `../fixtures-test-prebundle-demand-${environment}`,
    );
    const { fs } = await prepareFixtures({
      fixturesPath: cwd,
      fixturesTargetPath: target,
    });
    const testPath = path.join(target, 'index.test.ts');
    const original = fs.read(testPath);
    const { cli } = await runRstestCli({
      command: 'rstest',
      args: [
        'watch',
        '--config',
        'rstest.demand.config.mts',
        'index.test.ts',
        '--pool.maxWorkers',
        '1',
      ],
      options: {
        nodeOptions: {
          cwd: target,
          env: { PREBUNDLE_ENVIRONMENT: environment },
        },
      },
    });
    try {
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('Tests 1 passed');
      cli.resetStd();
      fs.update(
        testPath,
        `import { expect, it } from '@rstest/core';
const { JSDOM, Window } = require('./require-${environment}.cjs');
it('uses the environment dependency after a rebuild', () => {
  const dom = ${environment === 'jsdom' ? "new JSDOM('<p>watch</p>')" : '{ window: new Window() }'};
  dom.window.document.body.innerHTML = '<p>watch</p>';
  expect(dom.window.document.querySelector('p').textContent).toBe('watch');
  dom.window.close();
});`,
      );
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('Tests 1 passed');
      cli.resetStd();
      fs.update(testPath, original);
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).toContain('Tests 1 passed');
    } finally {
      await cli.killProcessTree();
      fs.delete(target);
    }
  });

  it.for(['forks', 'threads', 'vmForks', 'vmThreads', 'list', 'native'])(
    'installs the environment only for entries using the bridge under %s',
    async (mode, { onTestFinished }) => {
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          mode === 'list' ? 'list' : 'run',
          '--config',
          mode === 'native'
            ? 'rstest.native.config.mts'
            : 'rstest.demand.config.mts',
          ...(mode === 'list'
            ? []
            : mode === 'native'
              ? ['index.test.ts']
              : ['--pool', mode, '--pool.maxWorkers', '1']),
        ],
        options: {
          nodeOptions: {
            cwd,
            env: { DEBUG: 'rstest', PREBUNDLE_ENVIRONMENT: environment },
          },
        },
        onTestFinished,
      });
      await expectExecSuccess();
      const setupIndex = cli.log.indexOf(
        'globalSetup without DOM imports completed',
      );
      expect(setupIndex).toBeGreaterThan(-1);
      const loadIndex = cli.log.indexOf(
        `loaded bundled test environment ${environment}`,
      );
      if (mode === 'native') expect(loadIndex).toBe(-1);
      else expect(loadIndex).toBeGreaterThan(setupIndex);
    },
  );

  it.for(['forks', 'threads', 'vmForks', 'vmThreads'])(
    'shares bundled environment imports under %s',
    async (pool, { onTestFinished }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--config', 'rstest.shared.config.mts', '--pool', pool],
        options: {
          nodeOptions: { cwd, env: { PREBUNDLE_ENVIRONMENT: environment } },
        },
        onTestFinished,
      });
      await expectExecSuccess();
    },
  );

  it.for(['build', 'load'])(
    'keeps require and import usable after prebundle %s failure',
    async (failure, { onTestFinished }) => {
      const preload = fileURLToPath(
        new URL('./fixtures/prebundle/fail-prebundle.cjs', import.meta.url),
      );
      const { cli, expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--config', 'rstest.shared.config.mts'],
        options: {
          nodeOptions: {
            cwd,
            env: {
              PREBUNDLE_FAILURE: failure,
              PREBUNDLE_ENVIRONMENT: environment,
              NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
            },
          },
        },
        onTestFinished,
      });
      await expectExecSuccess();
      expect(cli.log).toContain('falling back to its native entry');
    },
  );

  it.for(['list', 'commonjs'])(
    'shares the environment during %s',
    async (mode, { onTestFinished }) => {
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: [
          mode === 'list' ? 'list' : 'run',
          '--config',
          'rstest.shared.config.mts',
          ...(mode === 'commonjs' ? ['--output.module', 'false'] : []),
        ],
        options: {
          nodeOptions: { cwd, env: { PREBUNDLE_ENVIRONMENT: environment } },
        },
        onTestFinished,
      });
      await expectExecSuccess();
    },
  );

  describe.for(['forks', 'threads'])('shared %s worker', (pool) => {
    it.for([
      'mock,imports,dynamic',
      'mock,dynamic,imports',
      'imports,mock,dynamic',
      'dynamic,mock,imports',
      'imports,dynamic,mock',
      'dynamic,imports,mock',
    ])(
      'shares the environment in a shared worker with order %s',
      async (order) => {
        const target = path.join(
          cwd,
          `../fixtures-test-bridge-order-${environment}-${pool}-${order.replaceAll(',', '-')}`,
        );
        const { fs } = await prepareFixtures({
          fixturesPath: cwd,
          fixturesTargetPath: target,
        });
        try {
          const files = order
            .split(',')
            .map(
              (name) =>
                `${environment === 'happy-dom' ? 'happy-' : ''}${name}.test.ts`,
            );
          fs.update(path.join(target, 'rstest.shared.config.mts'), (content) =>
            content.replace(
              'defineConfig({',
              "defineConfig({ name: 'bridge-order',",
            ),
          );
          for (const file of files) {
            fs.update(
              path.join(target, file),
              (content) => `${content}\nconsole.log('bridge-order:${file}');\n`,
            );
          }
          // The sequencer uses cached durations; control the order instead of relying
          // on whichever timings a previous fixture run happened to leave behind.
          const cacheDir = path.join(
            target,
            'node_modules/.cache/.rstest-results',
          );
          mkdirSync(cacheDir, { recursive: true });
          writeFileSync(
            path.join(cacheDir, 'results.json'),
            JSON.stringify({
              version: 2,
              files: Object.fromEntries(
                files.map((file, index) => [
                  `bridge-order\0${file}`,
                  {
                    duration: (files.length - index) * 100,
                    failed: false,
                    at: Date.now(),
                  },
                ]),
              ),
            }),
          );
          const { cli, expectExecSuccess } = await runRstestCli({
            command: 'rstest',
            args: [
              'run',
              '--config',
              'rstest.shared.config.mts',
              '--pool',
              pool,
              '--isolate',
              'false',
              '--pool.maxWorkers',
              '1',
              '--retry',
              '0',
            ],
            options: {
              nodeOptions: {
                cwd: target,
                env: { PREBUNDLE_ENVIRONMENT: environment },
              },
            },
          });
          await expectExecSuccess();
          expect(
            [...cli.stdout.matchAll(/bridge-order:([\w.-]+)/g)].map(
              (match) => match[1],
            ),
          ).toEqual(files);
        } finally {
          fs.delete(target);
        }
      },
    );
  });
});

it.for(['forks', 'threads', 'vmForks', 'vmThreads'])(
  'shares happy-dom 20 imports under %s',
  async (pool) => {
    const target = path.join(cwd, `../fixtures-test-happy-dom-20-${pool}`);
    const { fs } = await prepareFixtures({
      fixturesPath: cwd,
      fixturesTargetPath: target,
    });
    try {
      const packagePath = createRequire(import.meta.url).resolve(
        'happy-dom/package.json',
        {
          paths: [
            fileURLToPath(new URL('./fixtures-happy-dom-20', import.meta.url)),
          ],
        },
      );
      mkdirSync(path.join(target, 'node_modules'), { recursive: true });
      symlinkSync(
        path.dirname(packagePath),
        path.join(target, 'node_modules/happy-dom'),
        'junction',
      );
      const { expectExecSuccess } = await runRstestCli({
        command: 'rstest',
        args: ['run', '--config', 'rstest.shared.config.mts', '--pool', pool],
        options: {
          nodeOptions: {
            cwd: target,
            env: { PREBUNDLE_ENVIRONMENT: 'happy-dom' },
          },
        },
      });
      await expectExecSuccess();
    } finally {
      fs.delete(target);
    }
  },
);
