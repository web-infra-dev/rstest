import { afterEach, beforeEach, describe, expect, it, rs } from '@rstest/core';
import type vscode from 'vscode';
import {
  createMigrationNotice,
  rstackEditorTakesOver,
  showMigrationPrompt,
  showUnsupportedCoreMessage,
} from '../../src/migrationNotice';

let installed = new Set<string>();
let isTrusted = true;
const settings: Record<string, unknown> = {};
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
    workspace: {
      get isTrusted() {
        return isTrusted;
      },
      getConfiguration: (section: string) => ({
        get: (key: string, fallback: unknown) =>
          settings[`${section}.${key}`] ?? fallback,
      }),
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
    isTrusted = true;
    for (const key of Object.keys(settings)) {
      delete settings[key];
    }
  });

  it('keeps this extension active without the Rstack extension', () => {
    expect(rstackEditorTakesOver()).toBe(false);
  });

  it('stands down when the setting is default and the workspace is trusted', () => {
    installed = new Set(['rstack.rstack']);
    expect(rstackEditorTakesOver()).toBe(true);
  });

  it('stands down even when the workspace is untrusted', () => {
    installed = new Set(['rstack.rstack']);
    isTrusted = false;
    expect(rstackEditorTakesOver()).toBe(true);
  });

  it('stands down even when the Rstack extension has its Rstest stack switched off', () => {
    installed = new Set(['rstack.rstack']);
    settings['rstack.rstest.enable'] = false;
    expect(rstackEditorTakesOver()).toBe(true);
  });
});

describe('migration prompts', () => {
  it.each([
    [
      true,
      'uninstall',
      'Uninstall Rstest',
      'Rstack has taken over Rstest. Uninstall the standalone Rstest extension.',
    ],
    [
      false,
      'install',
      'Install Rstack',
      'The standalone Rstest extension is no longer maintained. Install the Rstack extension (rstack.rstack) to keep receiving updates.',
    ],
  ] as const)(
    'offers the migration action when standingDown=%s',
    async (standingDown, kind, action, message) => {
      await showMigrationPrompt(context, standingDown);
      expect(showWarningMessage).toHaveBeenCalledExactlyOnceWith(
        message,
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
      'The standalone Rstest extension was uninstalled. Reload the window to finish.',
    ],
    [
      false,
      'Install Rstack',
      'workbench.extensions.installExtension',
      ['rstack.rstack', { enable: true }],
      'Rstack was installed. Reload the window so exactly one copy of Rstest runs.',
    ],
  ] as const)(
    'runs the command and offers reload when standingDown=%s',
    async (standingDown, action, command, args, message) => {
      showWarningMessage.mockResolvedValueOnce(action);
      showInformationMessage.mockResolvedValueOnce('Reload Window');
      await showMigrationPrompt(context, standingDown);
      expect(executeCommand.mock.calls).toEqual([
        [command, ...args],
        ['workbench.action.reloadWindow'],
      ]);
      expect(showInformationMessage).toHaveBeenCalledExactlyOnceWith(
        message,
        'Reload Window',
      );
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'reports a failed migration command when standingDown=%s',
    async (standingDown) => {
      showWarningMessage.mockResolvedValueOnce(
        standingDown ? 'Uninstall Rstest' : 'Install Rstack',
      );
      executeCommand.mockRejectedValueOnce(new Error('Command failed'));
      await showMigrationPrompt(context, standingDown);
      expect(logError).toHaveBeenCalled();
      expect(showErrorMessage).toHaveBeenCalledExactlyOnceWith(
        'Command failed',
      );
      expect(showInformationMessage).not.toHaveBeenCalled();
    },
  );

  it('always offers installation for unsupported core, ignoring dismissal flags', async () => {
    flags.set('rstest.deprecation.installPromptDismissed', true);
    showErrorMessage.mockResolvedValueOnce('Install Rstack');
    await showUnsupportedCoreMessage('Unsupported core');
    await showUnsupportedCoreMessage('Unsupported core');
    expect(showErrorMessage.mock.calls).toEqual([
      ['Unsupported core', 'Install Rstack'],
      ['Unsupported core', 'Install Rstack'],
    ]);
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith(
      'workbench.extensions.installExtension',
      'rstack.rstack',
      { enable: true },
    );
  });

  it('switches the status bar to reload when Rstack becomes enabled', () => {
    installed.clear();
    createMigrationNotice(context, false);
    expect(item.text).toBe('$(sparkle-filled) Rstest → Rstack');
    installed.add('rstack.rstack');
    onExtensionsChanged();
    expect(item.text).toBe('$(sparkle-filled) Rstest: reload window');
    expect(item.command).toBe('workbench.action.reloadWindow');
    installed.clear();
  });
});
