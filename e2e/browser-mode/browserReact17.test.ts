import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

describe('browser mode - @rstest/browser-react (React 17)', () => {
  it('should work with legacy ReactDOM.render path under React 17', async () => {
    const { expectExecSuccess, cli } = await runBrowserCli('browser-react-17');
    await expectExecSuccess();

    expect(cli.stdout).toContain('render.test.tsx');
    expect(cli.stdout).toContain('renderHook.test.tsx');
    expect(cli.stdout).toContain('cleanup.test.tsx');

    expect(cli.stdout).toMatch(/Tests.*passed/);
  });
});
