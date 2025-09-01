import { inspect } from 'node:util';
import vscode from 'vscode';
import { getConfigValue, type LogLevel } from './config';

function formatValues(values: unknown[]): string {
  return values
    .map((value) =>
      typeof value === 'string'
        ? value
        : inspect(value, { depth: 4, colors: false }),
    )
    .join(' ');
}

export class Logger implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;
  private readonly disposables: vscode.Disposable[] = [];
  private level: LogLevel;

  constructor(private readonly name = 'Rstest') {
    this.channel = vscode.window.createOutputChannel(this.name);
    this.level = this.readLevel();
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('rstest.logLevel')) {
          this.level = this.readLevel();
        }
      }),
    );
  }

  public debug(...values: unknown[]) {
    if (this.level !== 'debug') {
      return;
    }

    this.write('DEBUG', values);
  }

  public info(...values: unknown[]) {
    this.write('INFO', values);
  }

  public warn(...values: unknown[]) {
    this.write('WARN', values);
  }

  public error(...values: unknown[]) {
    this.write('ERROR', values);
  }

  public dispose() {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.channel.dispose();
  }

  private readLevel(): LogLevel {
    return getConfigValue('logLevel');
  }

  private write(tag: string, values: unknown[]) {
    const timestamp = new Date().toISOString();
    const message = formatValues(values);
    this.channel.appendLine(`[${timestamp}] [${tag}] ${message}`);
  }
}

export const logger = new Logger();
