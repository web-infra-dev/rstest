import vscode from 'vscode';
import { BaseLogger, type LogLevel } from './shared/logger';

export class MasterLogger extends BaseLogger implements vscode.Disposable {
  readonly #channel: vscode.LogOutputChannel;

  constructor(private readonly name = 'Rstest') {
    super();
    this.#channel = vscode.window.createOutputChannel(this.name, { log: true });
  }

  override log(level: LogLevel, message: string) {
    this.#channel[level](message);
  }

  public dispose() {
    this.#channel.dispose();
  }
}

export const logger = new MasterLogger();
