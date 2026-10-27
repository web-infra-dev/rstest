import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { runCli } from './utils';

const appFilters = 'test/App';
const jestDomFilters = 'test/jestDom';

const externalConfigArgs = ['--config', 'rstest.externals.config.mts'];

it.for(['forks', 'threads', 'vmForks', 'vmThreads'] as const)(
  'formats React DOM assertions under %s',
  async (pool) => {
    for (const environment of ['jsdom', 'happy-dom']) {
      const { cli, expectExecSuccess } = await runCli(
        [appFilters, jestDomFilters],
        environment,
        {
          args: [
            '--pool',
            pool,
            '--pool.maxWorkers',
            '1',
            '--testNamePattern',
            'formats caught DOM assertions|uses jest-dom|matches DOM nodes across VM realms',
          ],
        },
      );
      await expectExecSuccess();
      expect(cli.stdout + cli.stderr).not.toContain('Accessing element.ref');
      expect(cli.stdout + cli.stderr).not.toContain('`key` is not a prop');
    }
  },
);

it.for(['forks', 'threads', 'vmForks', 'vmThreads'] as const)(
  'loads default and forced DOM prebundles without fallback under %s',
  async (pool, { onTestFinished }) => {
    const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));
    const run = (config?: string) =>
      runRstestCli({
        command: 'rstest',
        args: ['run', '--pool', pool, ...(config ? ['--config', config] : [])],
        onTestFinished,
        options: {
          nodeOptions: {
            cwd,
            env: { DEBUG: 'rstest' },
          },
        },
      });

    const defaultConfig = await run();
    await defaultConfig.expectExecSuccess();
    for (const environment of ['jsdom', 'happy-dom']) {
      expect(defaultConfig.cli.stdout).toContain(
        `loaded bundled test environment ${environment}`,
      );
    }
    expect(defaultConfig.cli.stdout + defaultConfig.cli.stderr).not.toContain(
      'falling back to its native entry',
    );

    const native = await run('rstest.native.config.mts');
    await native.expectExecSuccess();
    expect(native.cli.stdout + native.cli.stderr).not.toContain(
      'bundled test environment',
    );

    const forcedPrebundle = await run('rstest.prebundle.config.mts');
    await forcedPrebundle.expectExecSuccess();
    for (const environment of ['jsdom', 'happy-dom']) {
      expect(forcedPrebundle.cli.stdout).toContain(
        `loaded bundled test environment ${environment}`,
      );
    }
    expect(
      forcedPrebundle.cli.stdout + forcedPrebundle.cli.stderr,
    ).not.toContain('falling back to its native entry');
  },
);

describe('jsdom', () => {
  it('should keep automatic JSX runtime with an environment comment', async () => {
    const { cli, expectExecSuccess } = await runCli(
      [
        'test/environmentComment',
        'test/environmentCommentNode',
        'test/vitestEnvironmentReact',
      ],
      undefined,
      {
        args: ['--config', 'rstest.environmentComment.config.mts'],
      },
    );
    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(
      cli.stdout,
      'file-level @rstest-environment jsdom with options applies',
    ).toMatch(/✓ test\/environmentComment\.test\.ts/);
    expect(
      cli.stdout,
      'files without an environment comment stay in node',
    ).toMatch(/✓ test\/environmentCommentNode\.test\.ts/);
    expect(
      cli.stdout,
      '@vitest-environment jsdom keeps automatic JSX runtime',
    ).toMatch(/✓ test\/vitestEnvironmentReact\.test\.tsx/);
    await expectExecSuccess();
  });

  it('should list tests correctly with an environment comment', async () => {
    const { expectExecSuccess } = await runRstestCli({
      command: 'rstest',
      args: [
        'list',
        '--config',
        'rstest.environmentComment.config.mts',
        'test/environmentCommentNode',
        'test/vitestEnvironmentReact',
      ],
      options: {
        nodeOptions: {
          cwd: fileURLToPath(new URL('./fixtures', import.meta.url)),
        },
      },
    });
    await expectExecSuccess();
  });

  it('should run test correctly', async () => {
    const { cli, expectExecSuccess } = await runCli(
      [
        appFilters,
        'test/css',
        'test/handledError',
        'test/abortSignal',
        jestDomFilters,
        'test/storage',
        'test/objectUrl',
        'test/domScriptUrl',
        'test/timers',
      ],
      'jsdom',
    );
    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'React App renders under jsdom').toMatch(
      /✓ test\/App\.test\.tsx/,
    );
    expect(
      cli.stdout,
      'CSS modules and inline styles resolve under jsdom',
    ).toMatch(/✓ test\/css\.test\.tsx/);
    expect(
      cli.stdout,
      'window error event receives a handled click error in jsdom',
    ).toMatch(/✓ test\/handledError\.test\.tsx/);
    expect(
      cli.stdout,
      'Node AbortSignal accepted in jsdom event listeners',
    ).toMatch(/✓ test\/abortSignal\.test\.ts/);
    expect(cli.stdout, 'jest-dom matchers work under jsdom').toMatch(
      /✓ test\/jestDom\.test\.tsx/,
    );
    expect(cli.stdout, 'jsdom replaces Node web storage').toMatch(
      /✓ test\/storage\.test\.ts/,
    );
    expect(
      cli.stdout,
      'object URLs from jsdom Blob/File/iframe Blob/Node Blob',
    ).toMatch(/✓ test\/objectUrl\.test\.ts/);
    expect(
      cli.stdout,
      'object URLs available to scripts in the jsdom realm',
    ).toMatch(/✓ test\/domScriptUrl\.test\.ts/);
    expect(cli.stdout, 'pending jsdom timers do not block the run').toMatch(
      /✓ test\/timers\.test\.ts/,
    );
    await expectExecSuccess();
  });

  it('should run test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'jsdom', {
      args: externalConfigArgs,
    });
    await expectExecSuccess();
  });

  it('should run test correctly with custom environment options', async () => {
    const { expectExecSuccess } = await runCli('test/envOptions', undefined, {
      args: ['--config', 'rstest.envOptions.config.mts'],
    });
    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should run test correctly', async () => {
    const { cli, expectExecSuccess } = await runCli(
      [
        appFilters,
        'test/css',
        'test/handledError',
        'test/node',
        jestDomFilters,
        'test/storage',
        'test/textEncoder',
        'test/objectUrl',
        'test/timers',
      ],
      'happy-dom',
    );
    // Assert per file before the exit code, so a broken fixture fails the
    // expect that names its behavior.
    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'React App renders under happy-dom').toMatch(
      /✓ test\/App\.test\.tsx/,
    );
    expect(
      cli.stdout,
      'CSS modules and inline styles resolve under happy-dom',
    ).toMatch(/✓ test\/css\.test\.tsx/);
    expect(
      cli.stdout,
      'window error event receives a handled click error in happy-dom',
    ).toMatch(/✓ test\/handledError\.test\.tsx/);
    expect(cli.stdout, 'node built-ins load under happy-dom').toMatch(
      /✓ test\/node\.test\.ts/,
    );
    expect(cli.stdout, 'jest-dom matchers work under happy-dom').toMatch(
      /✓ test\/jestDom\.test\.tsx/,
    );
    expect(cli.stdout, 'happy-dom replaces Node web storage').toMatch(
      /✓ test\/storage\.test\.ts/,
    );
    expect(
      cli.stdout,
      'TextEncoder output equals Uint8Array under happy-dom',
    ).toMatch(/✓ test\/textEncoder\.test\.tsx/);
    expect(
      cli.stdout,
      'object URLs from happy-dom Blob/File/iframe Blob/Node Blob',
    ).toMatch(/✓ test\/objectUrl\.test\.ts/);
    expect(cli.stdout, 'pending happy-dom timers do not block the run').toMatch(
      /✓ test\/timers\.test\.ts/,
    );
    await expectExecSuccess();
  });

  it('should run Rsbuild tests under vmForks without process shims', async () => {
    const { expectExecSuccess } = await runCli('test/node', 'happy-dom', {
      args: ['--pool', 'vmForks', '--pool.memoryLimit', '256MB'],
    });
    await expectExecSuccess();
  });

  it('should run test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'happy-dom', {
      args: externalConfigArgs,
    });
    await expectExecSuccess();
  });
});

describe('happy-dom 20 compatibility', () => {
  it('runs the object URL test with happy-dom 20', async () => {
    const cwd = fileURLToPath(
      new URL('./fixtures-happy-dom-20', import.meta.url),
    );
    const { cli, expectExecSuccess } = await runCli(
      ['objectUrl', 'version'],
      'happy-dom',
      { cwd },
    );

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'the happy-dom 20 version fixture passes').toMatch(
      /✓ version\.test\.ts/,
    );
    expect(cli.stdout, 'object URLs work under happy-dom 20').toMatch(
      /✓ objectUrl\.test\.ts/,
    );
    await expectExecSuccess();
  });
});

describe('jsdom 30 compatibility', () => {
  it('keeps Node BroadcastChannel working with jsdom 30', async () => {
    const cwd = fileURLToPath(new URL('./fixtures-jsdom-30', import.meta.url));
    const { cli, expectExecSuccess } = await runCli(
      ['broadcastChannel', 'version'],
      'jsdom',
      { cwd },
    );

    await cli.exec;
    await cli.waitForStreamsEnd();
    expect(cli.stdout, 'the jsdom 30 version fixture passes').toMatch(
      /✓ version\.test\.ts/,
    );
    expect(
      cli.stdout,
      'Node BroadcastChannel delivers messages under jsdom 30',
    ).toMatch(/✓ broadcastChannel\.test\.ts/);
    await expectExecSuccess();
  });
});
