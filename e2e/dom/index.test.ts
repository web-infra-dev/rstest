import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { runCli } from './utils';

const appFilters = 'test/App';
const jestDomFilters = 'test/jestDom';

const externalConfigArgs = ['--config', 'rstest.externals.config.mts'];

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

  it('should prebundle by default and allow opting out', async ({
    onTestFinished,
  }) => {
    const cwd = fileURLToPath(new URL('./fixtures/prebundle', import.meta.url));
    const run = (config?: string) =>
      runRstestCli({
        command: 'rstest',
        args: ['run', ...(config ? ['--config', config] : [])],
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
    expect(defaultConfig.cli.stdout).toContain(
      'bundled test environment jsdom',
    );

    const native = await run('rstest.native.config.mts');
    await native.expectExecSuccess();
    expect(native.cli.stdout).not.toContain('bundled test environment jsdom');

    const explicitAuto = await run('rstest.prebundle.config.mts');
    await explicitAuto.expectExecSuccess();
    expect(explicitAuto.cli.stdout).toContain('bundled test environment jsdom');
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
