import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import type vscode from 'vscode';
import {
  createMigrationNotice,
  rstackEditorTakesOver,
  showMigrationPrompt,
  showUnsupportedCoreMessage,
} from '../../src/migrationNotice';

let installed = new Set<string>();
const showWarningMessage =
  rs.fn<(...args: string[]) => Promise<string | undefined>>();
const showInformationMessage =
  rs.fn<(...args: string[]) => Promise<string | undefined>>();
const showErrorMessage =
  rs.fn<(...args: string[]) => Promise<string | undefined>>();
const executeCommand = rs.fn();
const logError = rs.fn();
const flags = new Map<string, boolean>();
const update = rs.fn(async (key: string, value: boolean) => {
  flags.set(key, value);
});
let onExtensionsChanged: () => void;
const item = { text: '', command: undefined, show: rs.fn(), dispose: rs.fn() };

// Only the context fields used by migration notices are needed by this mock.
const context = {
  extension: { id: 'rstack.rstest' },
  subscriptions: [],
  globalState: { get: (key: string) => flags.get(key), update },
} as unknown as vscode.ExtensionContext;

beforeEach(() => {
  rs.resetAllMocks();
  flags.clear();
  update.mockImplementation(async (key, value) => {
    flags.set(key, value);
  });
  context.subscriptions.length = 0;
});

rs.mock('vscode', () => ({
  default: {
    MarkdownString: class {},
    ThemeColor: class {},
    StatusBarAlignment: { Right: 2 },
    commands: {
      executeCommand: (...args: unknown[]) => executeCommand(...args),
      registerCommand: () => ({ dispose() {} }),
    },
    extensions: {
      getExtension: (id: string) => (installed.has(id) ? { id } : undefined),
      onDidChange: (listener: () => void) => {
        onExtensionsChanged = listener;
        return { dispose() {} };
      },
    },
    window: {
      createOutputChannel: () => ({
        error: (...args: unknown[]) => logError(...args),
        warn() {},
      }),
      createStatusBarItem: () => item,
      showWarningMessage: (...args: string[]) => showWarningMessage(...args),
      showInformationMessage: (...args: string[]) =>
        showInformationMessage(...args),
      showErrorMessage: (...args: string[]) => showErrorMessage(...args),
    },
  },
}));

describe('rstackEditorTakesOver', () => {
  afterEach(() => {
    installed = new Set();
  });

  it('stands down only when Rstack is installed and enabled', () => {
    expect(rstackEditorTakesOver()).toBe(false);
    installed = new Set(['rstack.rstack']);
    expect(rstackEditorTakesOver()).toBe(true);
  });
});

describe('migration prompts', () => {
  it.each([
    [true, 'uninstall', 'Uninstall Rstest'],
    [false, 'install', 'Install Rstack'],
  ] as const)(
    'offers the migration action when standingDown=%s',
    async (standingDown, kind, action) => {
      await showMigrationPrompt(context, standingDown);
      expect(showWarningMessage).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        action,
        "Don't show again",
      );
      expect(executeCommand).not.toHaveBeenCalled();

      showWarningMessage.mockResolvedValueOnce("Don't show again");
      await showMigrationPrompt(context, standingDown);
      expect(update).toHaveBeenCalledExactlyOnceWith(
        `rstest.deprecation.${kind}PromptDismissed`,
        true,
      );
      showWarningMessage.mockClear();
      await showMigrationPrompt(context, standingDown);
      expect(showWarningMessage).not.toHaveBeenCalled();
      await showMigrationPrompt(context, !standingDown);
      expect(showWarningMessage).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [
      true,
      'Uninstall Rstest',
      'workbench.extensions.uninstallExtension',
      ['rstack.rstest'],
    ],
    [
      false,
      'Install Rstack',
      'workbench.extensions.installExtension',
      ['rstack.rstack', { enable: true }],
    ],
  ] as const)(
    'runs the command and offers reload when standingDown=%s',
    async (standingDown, action, command, args) => {
      showWarningMessage.mockResolvedValueOnce(action);
      showInformationMessage.mockResolvedValueOnce('Reload Window');
      await showMigrationPrompt(context, standingDown);
      expect(executeCommand.mock.calls).toEqual([
        [command, ...args],
        ['workbench.action.reloadWindow'],
      ]);
      expect(showInformationMessage).toHaveBeenCalledExactlyOnceWith(
        expect.any(String),
        'Reload Window',
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('reports a failed migration command', async () => {
    showWarningMessage.mockResolvedValueOnce('Uninstall Rstest');
    executeCommand.mockRejectedValueOnce(new Error('Command failed'));
    await showMigrationPrompt(context, true);
    expect(logError).toHaveBeenCalled();
    expect(showErrorMessage).toHaveBeenCalledExactlyOnceWith('Command failed');
    expect(showInformationMessage).not.toHaveBeenCalled();
  });

  it('offers installation for unsupported core', async () => {
    showErrorMessage.mockResolvedValueOnce('Install Rstack');
    await showUnsupportedCoreMessage('Unsupported core');
    expect(showErrorMessage).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      'Install Rstack',
    );
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      'workbench.extensions.installExtension',
      'rstack.rstack',
      { enable: true },
    );
  });

  it('shows each unsupported-core message only once per session', async () => {
    await Promise.all([
      showUnsupportedCoreMessage('Repeated unsupported core'),
      showUnsupportedCoreMessage('Repeated unsupported core'),
    ]);
    expect(showErrorMessage).toHaveBeenCalledTimes(1);
    await showUnsupportedCoreMessage('Different unsupported core');
    expect(showErrorMessage).toHaveBeenCalledTimes(2);
  });

  it('switches the status bar to reload when Rstack becomes enabled', () => {
    installed.clear();
    createMigrationNotice(context, false);
    expect(item.command).toBe('rstest.openRstackExtension');
    installed.add('rstack.rstack');
    onExtensionsChanged();
    expect(item.command).toBe('workbench.action.reloadWindow');
    installed.clear();
  });
});
