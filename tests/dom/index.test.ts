import { describe, it } from '@rstest/core';
import { runCli } from './utils';

const appFilters = 'test/App';
const jestDomFilters = 'test/jestDom';

const externalConfigArgs = ['--config', 'rstest.externals.config.ts'];

describe('jsdom', () => {
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
});

describe('happy-dom', () => {
  it('should run test correctly', async () => {
    const { expectExecSuccess } = await runCli(appFilters, 'happy-dom');
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
});
