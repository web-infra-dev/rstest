import os from 'node:os';
import { beforeEach, describe, expect, it, rs } from '@rstest/core';
import { RstestApi } from '../../src/master';

// Everything the extension surfaces: notifications the user cannot miss, the
// output channel, and the terminal a "Run in Terminal" would open.
const shownMessages: string[] = [];
const loggedErrors: string[] = [];
const createdTerminals: string[] = [];

rs.mock('vscode', () => {
  const channel = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message: string) => loggedErrors.push(message),
    show: () => {},
    dispose: () => {},
  };
  const vscode = {
    TestRunProfileKind: { Run: 1, Debug: 2, Coverage: 3 },
    FileCoverage: class {},
    Position: class {},
    Range: class {},
    Uri: {
      file: (fsPath: string) => ({
        fsPath,
        toString: () => `file://${fsPath}`,
      }),
    },
    extensions: { getExtension: () => undefined },
    window: {
      createOutputChannel: () => channel,
      createTerminal: (options: { name: string }) => {
        createdTerminals.push(options.name);
        return { show: () => {}, sendText: () => {}, dispose: () => {} };
      },
      onDidCloseTerminal: () => ({ dispose: () => {} }),
      showErrorMessage: (message: string) => shownMessages.push(message),
      showWarningMessage: (message: string) => shownMessages.push(message),
      showInformationMessage: (message: string) => shownMessages.push(message),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    },
  };
  return { ...vscode, default: vscode };
});

// A directory outside the repository, so Node's upward resolution cannot reach
// the workspace `node_modules` and `@rstest/core` is genuinely missing.
const noCoreDir = os.tmpdir();

const createApi = () => {
  const workspace = { uri: { fsPath: noCoreDir } };
  return new RstestApi(
    workspace as any,
    noCoreDir,
    `${noCoreDir}/rstest.config.ts`,
    {} as any,
  );
};

describe('RstestApi with a missing @rstest/core', () => {
  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    createdTerminals.length = 0;
  });

  it('should log an actionable message instead of notifying, while discovering projects', async () => {
    await expect(createApi().getNormalizedConfig()).rejects.toThrow(
      'Failed to resolve rstest path',
    );
    expect(shownMessages).toEqual([]);
    const logged = loggedErrors.join('\n');
    expect(logged).toContain(`Cannot find "@rstest/core" from ${noCoreDir}`);
    expect(logged).toContain('Install the project dependencies');
    expect(logged).not.toContain('Require stack');
  });

  it('should stay silent while listing tests', async () => {
    await expect(createApi().listTests()).rejects.toThrow(
      'Failed to resolve rstest path',
    );
    expect(shownMessages).toEqual([]);
  });

  it('should stay silent while running tests', async () => {
    await expect(
      createApi().runTest({ run: {} as any, token: {} as any }),
    ).rejects.toThrow('Failed to resolve rstest path');
    expect(shownMessages).toEqual([]);
  });

  it('should stay silent, and open no terminal, for a terminal run', () => {
    createApi().runInTerminal({});
    expect(shownMessages).toEqual([]);
    expect(createdTerminals).toEqual([]);
  });
});
