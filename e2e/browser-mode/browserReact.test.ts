import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - @rstest/browser-react', () => {
  it('should work with render, renderHook, cleanup, and @testing-library/dom', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-react');
    await expectExecSuccess();

    // Verify all test files ran
    expect(cli.stdout).toContain('render.test.tsx');
    expect(cli.stdout).toContain('renderHook.test.tsx');
    expect(cli.stdout).toContain('cleanup.test.tsx');
    expect(cli.stdout).toContain('testingLibraryDom.test.tsx');

    // Verify tests passed
    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
