import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from '@rstest/core';
import { runRstestCli } from '../../scripts/';

const __filename = fileURLToPath(import.meta.url);

const __dirname = dirname(__filename);

// Bug repro: a manual mock that is colocated inside the *mocked* workspace package's own
// directory (e.g. `packages/styles-lib/__mocks__/index.js`) is the same convention Jest uses
// for mocking user/workspace modules, and is very common in monorepos for shared packages
// that ship their own hand-written test mock next to the real implementation.
//
// Rstest's manual-mock lookup only checks a single fixed `<rootPath>/__mocks__` directory,
// where `rootPath` is the *consuming* package under test — never the resolved, real directory
// of the module being mocked. So a bare `rs.mock("workspace-pkg")` call silently falls back to
// automocking instead of finding `workspace-pkg`'s own `__mocks__/index.js`, turning any
// mocked function export into a `rs.fn()` stub that returns `undefined` by default.
//
// See fixtures/manualMockWorkspacePackage/{styles-lib,consumer} for the two linked workspace
// packages this reproduces against.
describe('manual mock colocated inside a workspace-linked package', () => {
  it("falls back to automock instead of finding the mocked package's own __mocks__ (known bug)", async ({
    onTestFinished,
  }) => {
    const { expectExecFailed } = await runRstestCli({
      command: 'rstest',
      args: ['run'],
      onTestFinished,
      options: {
        nodeOptions: {
          cwd: join(
            __dirname,
            '../fixtures/manualMockWorkspacePackage/consumer',
          ),
        },
      },
    });

    // TODO: once manual-mock resolution follows the resolved module's real path (matching
    // Jest), this should become `expectExecSuccess()` instead.
    await expectExecFailed();
  });
});
