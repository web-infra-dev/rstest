import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../scripts';
import { runCli } from './utils';

const appFilters = 'test/App';
const jestDomFilters = 'test/jestDom';

const externalConfigArgs = ['--config', 'rstest.externals.config.mts'];

describe('jsdom', () => {
  it('should run test correctly with environment comment', async () => {
    const { expectExecSuccess } = await runCli(
      'test/environmentComment',
      undefined,
      {
        args: ['--config', 'rstest.environmentComment.config.mts'],
      },
    );
    await expectExecSuccess();
  });

  it('should keep automatic JSX runtime with an environment comment', async () => {
    const { expectExecSuccess } = await runCli(
      ['test/environmentCommentNode', 'test/vitestEnvironmentReact'],
      undefined,
      {
        args: ['--config', 'rstest.environmentComment.config.mts'],
      },
    );
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
    const { expectExecSuccess } = await runCli(appFilters, 'jsdom');
    await expectExecSuccess();
  });

  it('should run test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'jsdom', {
      args: externalConfigArgs,
    });
    await expectExecSuccess();
  });

  it('should run test correctly with jest-dom', async () => {
    const { expectExecSuccess } = await runCli(jestDomFilters, 'jsdom');
    await expectExecSuccess();
  });

  it('should run test correctly with custom environment options', async () => {
    const { expectExecSuccess } = await runCli('test/envOptions', undefined, {
      args: ['--config', 'rstest.envOptions.config.mts'],
    });
    await expectExecSuccess();
  });

  it('should use jsdom timers', async () => {
    const { expectExecSuccess } = await runCli('test/timers', 'jsdom');
    await expectExecSuccess();
  });

  it('should restore timers between non-isolated jsdom files', async () => {
    const { expectExecSuccess } = await runCli(
      [
        'test/nonIsolatedTimersA',
        'test/nonIsolatedTimersB',
        'test/nonIsolatedTimersC',
      ],
      'jsdom',
      {
        args: ['--isolate=false', '--pool.maxWorkers=1'],
      },
    );
    await expectExecSuccess();
  });

  it('should run web storage test correctly', async () => {
    const { expectExecSuccess } = await runCli('test/storage', 'jsdom');
    await expectExecSuccess();
  });

  it('should create object URLs from jsdom Blob and File', async () => {
    const { expectExecSuccess } = await runCli('test/objectUrl', 'jsdom');
    await expectExecSuccess();
  });

  it('should expose object URLs to scripts in the jsdom realm', async () => {
    const { expectExecSuccess } = await runCli('test/domScriptUrl', 'jsdom');
    await expectExecSuccess();
  });
});

describe('happy-dom', () => {
  it('should run test correctly', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'happy-dom');
    await expectExecSuccess();
  });

  it('should use happy-dom timers', async () => {
    const { expectExecSuccess } = await runCli('test/timers', 'happy-dom');
    await expectExecSuccess();
  });

  it('should load node built-in modules correctly', async () => {
    const { expectExecSuccess } = await runCli('test/node', 'happy-dom');
    await expectExecSuccess();
  });

  it('should run test correctly with custom externals', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'happy-dom', {
      args: externalConfigArgs,
    });
    await expectExecSuccess();
  });

  it('should run test correctly with jest-dom', async () => {
    const { expectExecSuccess } = await runCli(jestDomFilters, 'happy-dom');
    await expectExecSuccess();
  });

  it('should run web storage test correctly', async () => {
    const { expectExecSuccess } = await runCli('test/storage', 'happy-dom');
    await expectExecSuccess();
  });

  it('should run TextEncoder correctly in happy-dom', async () => {
    const { expectExecSuccess } = await runCli('test/textEncoder', 'happy-dom');
    await expectExecSuccess();
  });

  it('should create object URLs from happy-dom Blob and File', async () => {
    const { expectExecSuccess } = await runCli('test/objectUrl', 'happy-dom');
    await expectExecSuccess();
  });
});
