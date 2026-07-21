import vscode from 'vscode';

// A single reused "Rstest" integrated terminal for the shell-terminal run mode.
// The terminal is recreated when its shell options change or the user closed
// it. Kept as a module singleton so runs from different projects share one
// terminal, mirroring how `logger` is a shared output channel.
let terminal: vscode.Terminal | undefined;
let signature = '';

export interface TerminalOptions {
  cwd: string;
  shellPath?: string;
  shellArgs?: string[];
}

export function runInTerminal(command: string, options: TerminalOptions): void {
  const sig = JSON.stringify(options);
  // Dispose when the user closed it (exitStatus set) or the shell changed.
  if (terminal && (terminal.exitStatus || signature !== sig)) {
    terminal.dispose();
    terminal = undefined;
  }
  if (!terminal) {
    terminal = vscode.window.createTerminal({
      name: 'Rstest',
      cwd: options.cwd,
      shellPath: options.shellPath || undefined,
      shellArgs: options.shellArgs?.length ? options.shellArgs : undefined,
    });
    signature = sig;
  }
  terminal.show(true);
  terminal.sendText(command);
}

export function disposeTerminal(): void {
  terminal?.dispose();
  terminal = undefined;
}

// POSIX single-quote quoting. Bare tokens (safe characters only) are left
// as-is for readability; everything else is single-quoted so the shell does
// not expand `$`, `^`, `(`, spaces, etc. in a `-t` pattern or a path.
export function shellQuote(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
