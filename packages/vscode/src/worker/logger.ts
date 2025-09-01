import { inspect } from 'node:util';

function format(values: unknown[]): string {
  return values
    .map((value) =>
      typeof value === 'string'
        ? value
        : inspect(value, { depth: 4, colors: false }),
    )
    .join(' ');
}

class WorkerLogger {
  public debug(...values: unknown[]) {
    console.log(format(values));
  }

  public info(...values: unknown[]) {
    console.log(format(values));
  }

  public warn(...values: unknown[]) {
    console.warn(format(values));
  }

  public error(...values: unknown[]) {
    console.error(format(values));
  }
}

export const logger = new WorkerLogger();
