import { formatWithOptions } from 'node:util';
import vscode from 'vscode';

function formatValues(values: unknown[]): string {
  return formatWithOptions({ depth: 4 }, ...values);
}

export class Logger implements vscode.Disposable {
  readonly #channel: vscode.LogOutputChannel;

  constructor(private readonly name = 'Rstest') {
    this.#channel = vscode.window.createOutputChannel(this.name, { log: true });
  }

  public trace(...values: unknown[]) {
    this.#channel.trace(formatValues(values));
  }

  public debug(...values: unknown[]) {
    this.#channel.debug(formatValues(values));
  }

  public info(...values: unknown[]) {
    this.#channel.info(formatValues(values));
  }

  public warn(...values: unknown[]) {
    this.#channel.warn(formatValues(values));
  }

  public error(...values: unknown[]) {
    this.#channel.error(formatValues(values));
  }

  public dispose() {
    this.#channel.dispose();
  }
}

export const logger = new Logger();
