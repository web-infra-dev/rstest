import vscode from 'vscode';
import { logger } from './logger';

const RSTACK_EXTENSION_ID = 'rstack.rstack';
const OPEN_EXTENSION_COMMAND = 'rstest.openRstackExtension';

const MIGRATION_NOTES_URL =
  'https://github.com/rstackjs/rstack-editor/blob/main/packages/vscode/README.md#coming-from-the-standalone-extensions';

/**
 * The Rstack extension bundles the same Rstest integration as this extension.
 * This predicate mirrors its VS Code-level gates (workspace trust and
 * `rstack.rstest.enable`), not project detection.
 * `extensions.getExtension` only sees enabled extensions, so a disabled
 * Rstack extension does not count. Trust needs no change listener: VS Code
 * does not activate this extension in Restricted Mode, and granted trust
 * cannot be revoked without a reload.
 */
export function rstackEditorTakesOver(): boolean {
  return (
    vscode.extensions.getExtension(RSTACK_EXTENSION_ID) !== undefined &&
    vscode.workspace.isTrusted &&
    vscode.workspace.getConfiguration('rstack.rstest').get('enable', true)
  );
}

type NoticeState = 'migrate' | 'off' | 'reload';

const NOTICES: Record<
  NoticeState,
  { text: string; tooltip: vscode.MarkdownString; log: string }
> = {
  migrate: {
    text: '$(sparkle-filled) Rstest → Rstack',
    tooltip: new vscode.MarkdownString(
      [
        '**The standalone Rstest extension is retired.**',
        '',
        `New editor features land in the unified **Rstack** extension (\`${RSTACK_EXTENSION_ID}\`), which covers testing, linting and formatting. Click to open it in the Extensions view.`,
        '',
        `Settings move from \`rstest.*\` to \`rstack.rstest.*\` and are not migrated automatically — see the [migration notes](${MIGRATION_NOTES_URL}).`,
      ].join('\n'),
    ),
    log: `The standalone Rstest extension is retired; new features land in ${RSTACK_EXTENSION_ID}. Migration notes: ${MIGRATION_NOTES_URL}`,
  },
  off: {
    text: '$(sparkle-filled) Rstest: off',
    tooltip: new vscode.MarkdownString(
      [
        `**Rstack (\`${RSTACK_EXTENSION_ID}\`) is running Rstest, so this extension is inactive.**`,
        '',
        'Click to open this extension in the Extensions view and uninstall it.',
      ].join('\n'),
    ),
    log: `${RSTACK_EXTENSION_ID} is active, so the standalone Rstest extension stands down. Uninstall it to remove this notice.`,
  },
  reload: {
    text: '$(sparkle-filled) Rstest: reload window',
    tooltip: new vscode.MarkdownString(
      [
        `**Rstack (\`${RSTACK_EXTENSION_ID}\`) changed after this window started.**`,
        '',
        'Click to reload the window so exactly one copy of Rstest runs.',
      ].join('\n'),
    ),
    log: `${RSTACK_EXTENSION_ID} changed after activation. Reload the window so exactly one copy of Rstest runs.`,
  },
};

/**
 * Non-modal status bar reminder that this extension is superseded by the
 * Rstack extension. `standingDown` is the decision `activate` made; a live
 * controller cannot be torn down (or created) afterwards, so whenever the
 * Rstack extension's state no longer matches that decision the notice asks
 * for a reload.
 */
export function createMigrationNotice(
  context: vscode.ExtensionContext,
  standingDown: boolean,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      OPEN_EXTENSION_COMMAND,
      (extensionId: string = RSTACK_EXTENSION_ID) =>
        vscode.commands.executeCommand(
          'workbench.extensions.search',
          `@id:${extensionId}`,
        ),
    ),
  );

  const item = vscode.window.createStatusBarItem(
    'rstest.migrationNotice',
    vscode.StatusBarAlignment.Right,
  );
  item.name = 'Rstest: Migrate to Rstack';
  item.backgroundColor = new vscode.ThemeColor(
    'statusBarItem.warningBackground',
  );
  context.subscriptions.push(item);

  const commands: Record<NoticeState, vscode.StatusBarItem['command']> = {
    migrate: OPEN_EXTENSION_COMMAND,
    off: {
      command: OPEN_EXTENSION_COMMAND,
      title: 'Uninstall the standalone Rstest extension',
      arguments: [context.extension.id],
    },
    reload: 'workbench.action.reloadWindow',
  };

  let state: NoticeState | undefined;
  const apply = (takesOver: boolean) => {
    const next: NoticeState =
      takesOver !== standingDown ? 'reload' : standingDown ? 'off' : 'migrate';
    if (next === state) {
      return;
    }
    state = next;
    const notice = NOTICES[next];
    item.text = notice.text;
    item.tooltip = notice.tooltip;
    item.command = commands[next];
    item.show();
    logger.warn(notice.log);
  };

  apply(standingDown);
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => apply(rstackEditorTakesOver())),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('rstack.rstest.enable')) {
        apply(rstackEditorTakesOver());
      }
    }),
  );
}
