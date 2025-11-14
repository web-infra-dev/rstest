import { formatWithOptions } from 'node:util';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export type Logger = {
  [K in LogLevel]: (...params: unknown[]) => void;
};

export abstract class BaseLogger implements Logger {
  constructor(private prefix?: string) {}
  protected log(level: LogLevel, message: string): void {
    console[level](message);
  }
  private logWithFormat(level: LogLevel, params: unknown[]) {
    this.log(
      level,
      formatWithOptions(
        { depth: 4 },
        ...(this.prefix ? [`[${this.prefix}]`] : []),
        ...params,
      ),
    );
  }
  trace(...params: unknown[]) {
    this.logWithFormat('trace', params);
  }
  debug(...params: unknown[]) {
    this.logWithFormat('debug', params);
  }
  info(...params: unknown[]) {
    this.logWithFormat('info', params);
  }
  warn(...params: unknown[]) {
    this.logWithFormat('warn', params);
  }
  error(...params: unknown[]) {
    this.logWithFormat('error', params);
  }
}
