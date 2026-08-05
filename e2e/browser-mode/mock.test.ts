import { describe, expect, it } from '@rstest/core';
import { runBrowserCli } from './utils';

// The browser client build applies the same mock transform pipeline as the
// node build (RstestPlugin + mock runtime + importActual rule). The fixture
// covers rs.mock factories, hoisting above imports, rs.hoisted,
// rs.importActual, rs.unmock/doMock/doUnmock, { spy: true }, { mock: true }
// automock, manual __mocks__ mocks, virtual modules, and rs.mockRequire.
describe('browser mode - module mocking', () => {
  it('runs the rs.mock family inside browser test files', async () => {
    const { cli, expectExecSuccess } = await runBrowserCli('browser-mock');

    await expectExecSuccess();

    expect(cli.stdout).toMatch(/Test Files.*11 passed/);
    expect(cli.stdout).toMatch(/Tests.*15 passed/);
  });
});
