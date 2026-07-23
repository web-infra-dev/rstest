import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import { RstestApi } from '../../src/master';

// Everything the extension surfaces: notifications the user cannot miss, the
// output channel, and the terminal a "Run in Terminal" would open.
const shownMessages: string[] = [];
const loggedErrors: string[] = [];
const createdTerminals: string[] = [];
const settings: Record<string, unknown> = {};

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
      getConfiguration: () => ({
        get: (key: string) => settings[key],
      }),
      onDidChangeConfiguration: () => ({ dispose: () => {} }),
    },
  };
  return { ...vscode, default: vscode };
});

// A directory outside the repository, so Node's upward resolution cannot reach
// the workspace `node_modules` and `@rstest/core` is genuinely missing.
const noCoreDir = os.tmpdir();

const createApi = (cwd = noCoreDir) => {
  const workspace = { uri: { fsPath: cwd } };
  return new RstestApi(
    workspace as any,
    cwd,
    `${cwd}/rstest.config.ts`,
    {} as any,
  );
};

describe('RstestApi with a missing @rstest/core', () => {
  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    createdTerminals.length = 0;
    for (const key of Object.keys(settings)) delete settings[key];
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

// Installed but unusable — an interrupted install, or a workspace link that
// has not been built. Advising an install would be wrong, and staying silent
// would hide a broken state the user has to repair.
describe('RstestApi with an unusable @rstest/core', () => {
  let root: string;

  beforeEach(() => {
    shownMessages.length = 0;
    loggedErrors.length = 0;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rstest-vscode-'));
    const pkgDir = path.join(root, 'node_modules', '@rstest', 'core');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      '{"name":"@rstest/core","version":"9.9.9","main":"./gone.js"}',
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should notify instead of reporting it as not installed', async () => {
    await expect(createApi(root).getNormalizedConfig()).rejects.toThrow();
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('gone.js');
    expect(loggedErrors.join('\n')).not.toContain(
      'Install the project dependencies',
    );
  });
});

// A configured `rstestPackagePath` that does not resolve is not the
// "dependencies are not installed yet" state — the user picked that path and
// has to fix it, so silence would strand them.
describe('RstestApi with an unresolvable rstestPackagePath', () => {
  const configured = `${noCoreDir}/vendor/core/package.json`;

  beforeEach(() => {
    shownMessages.length = 0;
    settings.rstestPackagePath = configured;
  });

  it('should notify while discovering projects', async () => {
    await expect(createApi().getNormalizedConfig()).rejects.toThrow();
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('rstest.rstestPackagePath');
    expect(shownMessages[0]).toContain(configured);
  });

  it('should notify for a terminal run', () => {
    createApi().runInTerminal({});
    expect(shownMessages).toHaveLength(1);
    expect(shownMessages[0]).toContain('rstest.rstestPackagePath');
    expect(createdTerminals).toEqual([]);
  });
});
