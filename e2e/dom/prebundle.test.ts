import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, it } from '@rstest/core';
import { prepareFixtures, runRstestCli } from '../scripts';

const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));

it('restores bridge requirements from the persistent build cache', async () => {
  const target = path.join(cwd, '../fixtures-test-prebundle-cache');
  const { fs } = await prepareFixtures({
    fixturesPath: cwd,
    fixturesTargetPath: target,
  });
  fs.update(path.join(target, 'rstest.demand.config.mts'), (content) =>
    content.replace(
      '...shared,',
      `...shared,
    performance: { buildCache: { cacheDirectory: '.cache/jsdom-bridge' } },
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
        options: { nodeOptions: { cwd: target } },
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
  const target = path.join(cwd, '../fixtures-test-prebundle-demand');
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
    options: { nodeOptions: { cwd: target } },
  });
  try {
    await cli.waitForStdout('Waiting for file changes...');
    expect(cli.stdout).toContain('Tests 1 passed');
    cli.resetStd();
    fs.update(
      testPath,
      `import { expect, it } from '@rstest/core';
const { JSDOM } = require('./require-jsdom.cjs');
it('uses jsdom after a rebuild', () => {
  const dom = new JSDOM('<p>watch</p>');
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
  'installs jsdom only for entries using the bridge under %s',
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
      options: { nodeOptions: { cwd, env: { DEBUG: 'rstest' } } },
      onTestFinished,
    });
    await expectExecSuccess();
    const setupIndex = cli.log.indexOf('globalSetup without jsdom completed');
    expect(setupIndex).toBeGreaterThan(-1);
    const loadIndex = cli.log.indexOf('loaded bundled test environment jsdom');
    if (mode === 'native') expect(loadIndex).toBe(-1);
    else expect(loadIndex).toBeGreaterThan(setupIndex);
  },
);

it.for(['forks', 'threads', 'vmForks', 'vmThreads'])(
  'shares bundled jsdom imports under %s',
  async (pool, { onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: ['run', '--config', 'rstest.shared.config.mts', '--pool', pool],
      options: { nodeOptions: { cwd } },
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

it.for(['list', 'commonjs', 'shared-worker'])(
  'shares jsdom during %s',
  async (mode, { onTestFinished }) => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        mode === 'list' ? 'list' : 'run',
        '--config',
        'rstest.shared.config.mts',
        ...(mode === 'commonjs' ? ['--output.module', 'false'] : []),
        ...(mode === 'shared-worker'
          ? ['--isolate', 'false', '--pool.maxWorkers', '1']
          : []),
      ],
      options: { nodeOptions: { cwd } },
      onTestFinished,
    });
    await expectExecSuccess();
  },
);
