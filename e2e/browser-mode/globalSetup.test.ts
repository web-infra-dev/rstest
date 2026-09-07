import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { prepareFixtures, sleep } from '../scripts';
import {
  deleteFixtureTarget,
  killCliProcessTree,
  runBrowserCli,
  runBrowserWatchCli,
  runBrowserWatchCliWithCwd,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const expectSignalExitDuringRestartCleanup = async ({
  fixtureName,
  targetName,
  globalSetupPath,
  setupMarker,
  teardownMarker,
}: {
  fixtureName: string;
  targetName: string;
  globalSetupPath: string;
  setupMarker: string;
  teardownMarker: string;
}) => {
  const fixturesTargetPath = path.join(
    __dirname,
    `fixtures/fixtures-test-${targetName}`,
  );
  const { fs } = await prepareFixtures({
    fixturesPath: path.join(__dirname, `fixtures/${fixtureName}`),
    fixturesTargetPath,
  });
  const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
  const teardownStartedMarker = teardownMarker.replace('executed', 'started');
  fs.update(path.join(fixturesTargetPath, globalSetupPath), (content) =>
    content.replace(
      `console.log('${teardownMarker}');`,
      `console.log('${teardownStartedMarker}');\n    await new Promise((resolve) => setTimeout(resolve, 1500));\n    console.log('${teardownMarker}');`,
    ),
  );
  const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
  const { cli } = result;

  try {
    await cli.waitForStdout('Waiting for file changes...');
    await sleep(200);

    cli.resetStd();
    fs.update(configPath, (content) => `${content}\n// trigger restart`);
    await cli.waitForStdout('restarting Rstest');
    await cli.waitForStdout(teardownStartedMarker);

    cli.exec.process!.kill('SIGINT');
    await result.expectExecFailed();

    expect(cli.exec.process!.exitCode).toBe(130);
    expect(cli.stdout).toContain('Received SIGINT, cleaning up...');
    expect(cli.stdout).toContain(teardownMarker);
    expect(cli.stdout).not.toContain(setupMarker);
  } finally {
    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }
};

const expectSignalExitDuringGlobalSetup = async ({
  fixtureName,
  targetName,
  globalSetupPath,
  setupMarker,
  teardownMarker,
}: {
  fixtureName: string;
  targetName: string;
  globalSetupPath: string;
  setupMarker: string;
  teardownMarker: string;
}) => {
  const fixturesTargetPath = path.join(
    __dirname,
    `fixtures/fixtures-test-${targetName}`,
  );
  const { fs } = await prepareFixtures({
    fixturesPath: path.join(__dirname, `fixtures/${fixtureName}`),
    fixturesTargetPath,
  });
  fs.update(path.join(fixturesTargetPath, globalSetupPath), (content) =>
    content.replace(
      `console.log('${setupMarker}');`,
      `console.log('${setupMarker}');\n  await new Promise((resolve) => setTimeout(resolve, 1500));`,
    ),
  );
  const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
  const { cli } = result;

  try {
    await cli.waitForStdout(setupMarker);
    cli.resetStd();

    cli.exec.process!.kill('SIGINT');
    await result.expectExecFailed();

    expect(cli.exec.process!.exitCode).toBe(130);
    expect(cli.stdout).toContain('Received SIGINT, cleaning up...');
    expect(cli.stdout).toContain(teardownMarker);
    expect(cli.stdout).not.toContain('Waiting for file changes...');
  } finally {
    await killCliProcessTree(cli);
    await deleteFixtureTarget(fs, fixturesTargetPath);
  }
};

// Browser projects run `globalSetup` in an isolated setup worker and propagate
// its env change-set into the browser runtime store. Explicit `test.env` config
// still takes precedence.
describe('browser mode - globalSetup', () => {
  it('runs globalSetup, propagates env into browser tests, and tears down in order', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup',
    );

    await expectExecSuccess();

    const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
    const testIndex = cli.stdout.indexOf('[browser-global-setup-test] running');
    const teardownIndex = cli.stdout.indexOf(
      '[browser-global-teardown] executed',
    );
    const serverCloseIndex = cli.stdout.lastIndexOf(
      '[browser-dev-server] closed',
    );

    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThan(setupIndex);
    expect(serverCloseIndex).toBeGreaterThan(testIndex);
    expect(teardownIndex).toBeGreaterThan(serverCloseIndex);
  });

  it('runs globalSetup and teardown around browser test collection', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup',
      { command: 'list' },
    );

    await expectExecSuccess();

    const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
    const testIndex = cli.stdout.indexOf(
      'tests/globalSetup.test.ts > browser globalSetup env propagation (from-global-setup) > reads env changes made by globalSetup',
    );
    const teardownIndex = cli.stdout.indexOf(
      '[browser-global-teardown] executed',
    );
    const serverCloseIndex = cli.stdout.lastIndexOf(
      '[browser-dev-server] closed',
    );

    expect(setupIndex).toBeGreaterThanOrEqual(0);
    expect(testIndex).toBeGreaterThan(setupIndex);
    expect(serverCloseIndex).toBeGreaterThan(testIndex);
    expect(teardownIndex).toBeGreaterThan(serverCloseIndex);
  });

  it('skips globalSetup when the shard slice has no files for the project', async () => {
    // The fixture has a single test file: shard 2/2 is deterministically
    // empty, so the stage must not run setup (or queue teardown) for it —
    // and the browser cycle must honor the same shard and run no tests.
    const { cli } = await runBrowserCli('browser-global-setup', {
      args: ['--shard=2/2'],
    });

    await cli.exec;

    expect(cli.stdout).not.toContain('[browser-global-setup] executed');
    expect(cli.stdout).not.toContain('[browser-global-teardown] executed');
    expect(cli.stdout).not.toContain('[browser-global-setup-test] running');
  });

  it('reports every project globalSetup failure before tests run', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runBrowserCli(
      'browser-global-setup-error',
    );

    await expectExecFailed();

    expectStderrLog(/Global setup A failed intentionally/);
    expect(cli.log).toContain('Global setup B failed intentionally');
    expect(cli.log).not.toContain('Project A test should not be printed');
    expect(cli.log).not.toContain('Project B test should not be printed');
  });

  it('runs each project globalSetup in a mixed node + browser run', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup-mixed',
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('[mixed-node-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-node-global-teardown] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
    expect(cli.stdout).toMatch(/Tests.*2 passed/);

    const firstTeardownIndex = Math.min(
      cli.stdout.indexOf('[mixed-node-global-teardown] executed'),
      cli.stdout.indexOf('[mixed-browser-global-teardown] executed'),
    );
    const nodeServerCloseIndex = cli.stdout.lastIndexOf(
      '[mixed-node-dev-server] closed',
    );
    const browserServerCloseIndex = cli.stdout.lastIndexOf(
      '[mixed-browser-dev-server] closed',
    );
    expect(nodeServerCloseIndex).toBeGreaterThanOrEqual(0);
    expect(browserServerCloseIndex).toBeGreaterThanOrEqual(0);
    expect(nodeServerCloseIndex).toBeLessThan(firstTeardownIndex);
    expect(browserServerCloseIndex).toBeLessThan(firstTeardownIndex);
  });

  for (const [name, args] of [
    ['without sharding', []],
    ['with sharding', ['--shard=1/1']],
  ] as const) {
    it(`runs browser globalSetup before mixed node test collection ${name}`, async () => {
      const { cli, expectExecSuccess } = await runBrowserCli(
        'browser-global-setup-mixed',
        { command: 'list', args: [...args] },
      );

      await expectExecSuccess();

      const setupIndex = cli.stdout.indexOf(
        '[mixed-browser-global-setup] executed',
      );
      const nodeTestIndex = cli.stdout.indexOf(
        'project-node/tests/node.test.ts > node collection sees browser setup (from-browser-setup) > reads the node project globalSetup env change',
      );

      expect(setupIndex).toBeGreaterThanOrEqual(0);
      expect(nodeTestIndex).toBeGreaterThan(setupIndex);
    });
  }

  it('drains global teardown on the mixed path when a file filter selects only the browser project', async () => {
    // With no node tests to run, the node executor is never constructed, so the
    // teardown drain must live in core — otherwise the setup's IPC child leaks
    // and the process hangs (the awaited exec would time out here).
    const { cli, expectExecSuccess } = await runBrowserCli(
      'browser-global-setup-mixed',
      { args: ['project-browser/tests/browserOnly.test.ts'] },
    );

    await expectExecSuccess();

    expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
    expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
    // The node project matches no running tests, so its globalSetup must not run.
    expect(cli.stdout).not.toContain('[mixed-node-global-setup] executed');
  });

  it('preserves a global teardown failure when quitting browser-only watch', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-teardown-error',
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    fixtureFs.update(
      path.join(fixturesTargetPath, 'globalSetup.ts'),
      (content) =>
        content.replace(
          "console.log('[browser-global-teardown] executed');",
          "throw new Error('Browser global teardown failed intentionally');",
        ),
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('Waiting for file changes...');
      cli.exec.process!.stdin!.write('q');
      await result.expectExecFailed();

      expect(cli.exec.process!.exitCode).toBe(1);
      expect(cli.log).toContain('Browser global teardown failed intentionally');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fixtureFs, fixturesTargetPath);
    }
  }, 60_000);

  it('validates the browser package before browser-only watch globalSetup', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-version-mismatch',
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    const browserPackagePath = path.join(
      fixturesTargetPath,
      'node_modules/@rstest/browser',
    );
    fs.mkdirSync(browserPackagePath, { recursive: true });
    fs.writeFileSync(
      path.join(browserPackagePath, 'package.json'),
      JSON.stringify({
        name: '@rstest/browser',
        version: '0.0.0-review-test',
        type: 'module',
        exports: {
          './internal': './internal.js',
          './package.json': './package.json',
        },
      }),
    );
    const browserEntry = pathToFileURL(
      path.join(__dirname, '../../packages/browser/dist/index.js'),
    ).href;
    fs.writeFileSync(
      path.join(browserPackagePath, 'internal.js'),
      `export * from ${JSON.stringify(browserEntry)};`,
    );

    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await result.expectExecFailed();

      expect(cli.exec.process!.exitCode).toBe(1);
      expect(cli.stderr).toContain(
        'Version mismatch between @rstest/core and @rstest/browser',
      );
      expect(cli.stdout).not.toContain('[browser-global-setup] executed');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fixtureFs, fixturesTargetPath);
    }
  }, 60_000);

  it('validates node dependencies before mixed-watch browser globalSetup', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-mixed-node-dependency',
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup-mixed'),
      fixturesTargetPath,
    });
    fixtureFs.update(
      path.join(fixturesTargetPath, 'project-node/rstest.config.mts'),
      (content) =>
        content.replace(
          "include: ['tests/**/*.test.ts'],",
          "include: ['tests/**/*.test.ts'],\n  testEnvironment: 'jsdom',",
        ),
    );
    const blockJsdomPath = path.join(fixturesTargetPath, 'block-jsdom.cjs');
    fs.writeFileSync(
      blockJsdomPath,
      `const Module = require('node:module');
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'jsdom') {
    const error = new Error('blocked jsdom resolution');
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return originalResolveFilename.call(this, request, ...args);
};
`,
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath, {
      env: {
        CI: 'true',
        NODE_OPTIONS: `--require=${blockJsdomPath}`,
      },
    });
    const { cli } = result;

    try {
      await result.expectExecFailed();

      expect(cli.log).toContain(
        'Failed to load testEnvironment "jsdom" dependency',
      );
      expect(cli.stdout).not.toContain('[mixed-browser-global-setup] executed');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fixtureFs, fixturesTargetPath);
    }
  }, 60_000);

  it('drains partial globalSetup teardowns when a later setup fails', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-partial-failure',
    );
    const { fs: fixtureFs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    fixtureFs.update(
      path.join(fixturesTargetPath, 'rstest.config.mts'),
      (content) =>
        content.replace(
          "globalSetup: ['./globalSetup.ts'],",
          "globalSetup: ['./globalSetup.ts', './secondGlobalSetup.ts', './failingGlobalSetup.ts'],",
        ),
    );
    fs.writeFileSync(
      path.join(fixturesTargetPath, 'secondGlobalSetup.ts'),
      `export default function secondGlobalSetup() {
  return function secondGlobalTeardown() {
    console.log('[second-browser-global-teardown] executed');
    throw new Error('Second browser global teardown failed intentionally');
  };
}
`,
    );
    fs.writeFileSync(
      path.join(fixturesTargetPath, 'failingGlobalSetup.ts'),
      `export default function failingGlobalSetup() {
  throw new Error('Later browser globalSetup failed intentionally');
}
`,
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await result.expectExecFailed();

      expect(cli.log).toContain(
        'Later browser globalSetup failed intentionally',
      );
      expect(cli.log).toContain(
        'Second browser global teardown failed intentionally',
      );
      expect(cli.stdout).toContain('[browser-global-setup] executed');
      expect(cli.stdout).toContain('[second-browser-global-teardown] executed');
      expect(cli.stdout).toContain('[browser-global-teardown] executed');
      expect(
        cli.stdout.indexOf('[second-browser-global-teardown] executed'),
      ).toBeLessThan(cli.stdout.indexOf('[browser-global-teardown] executed'));
      expect(cli.stdout).not.toContain('[browser-global-setup-test] running');
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fixtureFs, fixturesTargetPath);
    }
  }, 60_000);

  it('runs globalSetup once per watch session and reruns it only on a config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');

      // The session's one setup, before its first tests.
      const initialSetupIndex = cli.stdout.indexOf(
        '[browser-global-setup] executed',
      );
      const initialTestIndex = cli.stdout.indexOf('Test Files 1 passed');
      expect(initialSetupIndex).toBeGreaterThanOrEqual(0);
      expect(initialTestIndex).toBeGreaterThan(initialSetupIndex);
      expect(cli.stdout).toMatch(/Tests.*4 passed/);

      // A rerun stays inside the session, so it must not run setup again.
      await sleep(1000);
      cli.resetStd();
      cli.exec.process!.stdin!.write('a');

      await cli.waitForStdout('Re-running 1 affected test file(s)');
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');
      expect(cli.stdout).not.toContain('[browser-global-setup] executed');

      // A config restart ends the session: teardown, then a fresh setup.
      await sleep(1000);
      cli.resetStd();
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[browser-global-teardown] executed');
      await cli.waitForStdout('[browser-global-setup] executed');
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');

      const teardownIndex = cli.stdout.indexOf(
        '[browser-global-teardown] executed',
      );
      const setupIndex = cli.stdout.indexOf('[browser-global-setup] executed');
      const testIndex = cli.stdout.indexOf('Test Files 1 passed');
      expect(setupIndex).toBeGreaterThan(teardownIndex);
      expect(testIndex).toBeGreaterThan(setupIndex);

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  it('waits for an in-flight browser-only globalSetup before config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-inflight-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    fs.update(path.join(fixturesTargetPath, 'globalSetup.ts'), (content) =>
      content.replace(
        "console.log('[browser-global-setup] executed');",
        "console.log('[browser-global-setup] executed');\n  await new Promise((resolve) => setTimeout(resolve, 1500));",
      ),
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('[browser-global-setup] executed');
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[browser-global-teardown] executed');
      await cli.waitForStdout('Test Files 1 passed');
      await cli.waitForStdout('Waiting for file changes...');

      const setupMatches = cli.stdout.match(
        /\[browser-global-setup\] executed/g,
      );
      expect(setupMatches).toHaveLength(2);
      expect(
        cli.stdout.indexOf('[browser-global-teardown] executed'),
      ).toBeLessThan(cli.stdout.lastIndexOf('[browser-global-setup] executed'));

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  it('reruns node and browser globalSetup after a mixed config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-mixed-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup-mixed'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    fs.update(
      path.join(
        fixturesTargetPath,
        'project-browser/tests/browserOnly.test.ts',
      ),
      (content) =>
        content.replace(
          '() => {\n',
          'async () => {\n  await new Promise((resolve) => setTimeout(resolve, 2000));\n',
        ),
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('[mixed-node-global-setup] executed');
      await cli.waitForStdout('[Browser UI] WebSocket server started');
      // Both stages ran before the host launch (synchronous read — the restart
      // below must fire while the first cycle is still mid-flight).
      expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
      cli.resetStd();
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[mixed-node-global-teardown] executed');
      await cli.waitForStdout('[mixed-browser-global-teardown] executed');
      await cli.waitForStdout('[mixed-node-global-setup] executed');
      await cli.waitForStdout('[mixed-browser-global-setup] executed');
      await cli.waitForStdout(/✓ .*node\.test\.ts/);
      await cli.waitForStdout(/✓ .*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[mixed-node-global-teardown\] executed/g),
      ).toHaveLength(2);
      expect(
        cli.stdout.match(/\[mixed-browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  it('waits for an in-flight browser globalSetup before mixed config restart', async () => {
    const fixturesTargetPath = path.join(
      __dirname,
      'fixtures/fixtures-test-browser-global-setup-mixed-inflight-restart',
    );
    const { fs } = await prepareFixtures({
      fixturesPath: path.join(__dirname, 'fixtures/browser-global-setup-mixed'),
      fixturesTargetPath,
    });
    const configPath = path.join(fixturesTargetPath, 'rstest.config.mts');
    fs.update(
      path.join(fixturesTargetPath, 'project-browser/globalSetup.ts'),
      (content) =>
        content.replace(
          "console.log('[mixed-browser-global-setup] executed');",
          "console.log('[mixed-browser-global-setup] executed');\n  await new Promise((resolve) => setTimeout(resolve, 1500));",
        ),
    );
    const result = await runBrowserWatchCliWithCwd(fixturesTargetPath);
    const { cli } = result;

    try {
      await cli.waitForStdout('[mixed-browser-global-setup] executed');
      fs.update(configPath, (content) => `${content}\n// trigger restart`);

      await cli.waitForStdout('restarting Rstest');
      await cli.waitForStdout('[mixed-browser-global-teardown] executed');
      await cli.waitForStdout('[mixed-node-global-setup] executed');
      await cli.waitForStdout(/✓ .*node\.test\.ts/);
      await cli.waitForStdout(/✓ .*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      expect(
        cli.stdout.match(/\[mixed-browser-global-setup\] executed/g),
      ).toHaveLength(2);
      expect(cli.stdout).not.toContain('Browser Mode watch session failed');

      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();
      expect(
        cli.stdout.match(/\[mixed-browser-global-teardown\] executed/g),
      ).toHaveLength(2);
    } finally {
      await killCliProcessTree(cli);
      await deleteFixtureTarget(fs, fixturesTargetPath);
    }
  }, 60_000);

  // Browser-only shape is enough here: the delayed stage is the same
  // `runBrowserGlobalSetupStage` call site on both shapes and the SIGINT
  // handler is shape-agnostic; the mixed shape keeps its own signal coverage
  // in the restart-cleanup pair below, where a node teardown is what blocks.
  it.skipIf(process.platform === 'win32')(
    'handles SIGINT during browser-only globalSetup',
    () =>
      expectSignalExitDuringGlobalSetup({
        fixtureName: 'browser-global-setup',
        targetName: 'browser-global-setup-signal',
        globalSetupPath: 'globalSetup.ts',
        setupMarker: '[browser-global-setup] executed',
        teardownMarker: '[browser-global-teardown] executed',
      }),
    60_000,
  );

  it.skipIf(process.platform === 'win32').each([
    {
      name: 'browser-only',
      fixtureName: 'browser-global-setup',
      targetName: 'browser-global-setup-restart-signal',
      globalSetupPath: 'globalSetup.ts',
      setupMarker: '[browser-global-setup] executed',
      teardownMarker: '[browser-global-teardown] executed',
    },
    {
      name: 'mixed',
      fixtureName: 'browser-global-setup-mixed',
      targetName: 'browser-global-setup-mixed-restart-signal',
      globalSetupPath: 'project-node/globalSetup.ts',
      setupMarker: '[mixed-browser-global-setup] executed',
      teardownMarker: '[mixed-node-global-teardown] executed',
    },
  ])(
    'keeps SIGINT handling active during $name config restart cleanup',
    expectSignalExitDuringRestartCleanup,
    60_000,
  );

  it('runs browser globalSetup in mixed watch when only browser tests are selected', async () => {
    const result = await runBrowserWatchCli('browser-global-setup-mixed', {
      args: ['project-browser/tests/browserOnly.test.ts'],
    });
    const { cli } = result;

    try {
      await cli.waitForStdout(/✓ .*browserOnly\.test\.ts/);
      await cli.waitForStdout('Waiting for file changes...');

      expect(cli.stdout).toContain('[mixed-browser-global-setup] executed');
      expect(cli.stdout).not.toContain('[mixed-node-global-setup] executed');

      // The banner above is the settle signal; quit needs no debounce.
      cli.exec.process!.stdin!.write('q');
      await result.expectExecSuccess();

      expect(cli.stdout).toContain('[mixed-browser-global-teardown] executed');
      expect(cli.stdout).not.toContain('[mixed-node-global-teardown] executed');
    } finally {
      await killCliProcessTree(cli);
    }
  }, 60_000);

  it('reports every project globalSetup failure in browser-only watch', async () => {
    const { cli, expectExecFailed, expectStderrLog } = await runBrowserWatchCli(
      'browser-global-setup-error',
    );

    await expectExecFailed();

    expectStderrLog(/Global setup A failed intentionally/);
    expect(cli.log).toContain('Global setup B failed intentionally');
    expect(cli.log).not.toContain('Project A test should not be printed');
    expect(cli.log).not.toContain('Project B test should not be printed');
  });
});
