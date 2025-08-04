/**
 * MIT License
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 */
import { AssertionError, strict as assert } from 'node:assert';
import { Console } from 'node:console';
import {
  format,
  formatWithOptions,
  type InspectOptions,
  inspect,
} from 'node:util';
import { color, prettyTime } from '../../utils';
import type { WorkerRPC } from './rpc';

const RealDate = Date;

export type LogCounters = {
  [label: string]: number;
};

export type LogTimers = {
  [label: string]: Date;
};

export function createCustomConsole({
  rpc,
  testPath,
  printConsoleTrace,
}: {
  rpc: WorkerRPC;
  testPath: string;
  printConsoleTrace: boolean;
}): Console {
  const getConsoleTrace = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 4;
    const stack = new Error('STACK_TRACE').stack;
    const trace = stack?.split('\n').slice(4).join('\n');
    Error.stackTraceLimit = limit;

    return trace;
  };

  /**
   * This method is modified based on source found in
   * https://github.com/jestjs/jest/blob/c13bca305508716ca99552b5c32a884ce090fecf/packages/jest-console/src/CustomConsole.ts
   */
  class CustomConsole extends Console {
    private _counters: LogCounters = {};
    private _timers: LogTimers = {};
    private _groupDepth = 0;

    override Console: typeof Console = Console;

    private getPrettyName(type: string): string {
      switch (type) {
        case 'error':
          return color.red(type);
        case 'warn':
          return color.yellow(type);
        case 'info':
          return color.cyan(type);
        default:
          return color.gray(type);
      }
    }

    private _log(
      name: string,
      message: string,
      type: 'stderr' | 'stdout' = 'stdout',
    ) {
      rpc.onConsoleLog({
        content: '  '.repeat(this._groupDepth) + message,
        name: this.getPrettyName(name),
        testPath,
        type,
        trace: printConsoleTrace ? getConsoleTrace() : undefined,
      });
    }

    override assert(value: unknown, message?: string | Error): asserts value {
      try {
        assert(value, message);
      } catch (error) {
        if (!(error instanceof AssertionError)) {
          throw error;
        }
        // https://github.com/jestjs/jest/pull/13422#issuecomment-1273396392
        this._log(
          'assert',
          error.toString().replaceAll(/:\n\n.*\n/gs, ''),
          'stderr',
        );
      }
    }

    override count(label = 'default'): void {
      if (!this._counters[label]) {
        this._counters[label] = 0;
      }

      this._log('count', format(`${label}: ${++this._counters[label]}`));
    }

    override countReset(label = 'default'): void {
      this._counters[label] = 0;
    }

    override debug(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('debug', format(firstArg, ...args));
    }

    override dir(firstArg: unknown, options: InspectOptions = {}): void {
      const representation = inspect(firstArg, options);
      this._log('dir', formatWithOptions(options, representation));
    }

    override dirxml(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('dirxml', format(firstArg, ...args));
    }

    override error(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('error', format(firstArg, ...args), 'stderr');
    }

    override group(title?: string, ...args: Array<unknown>): void {
      this._groupDepth++;

      if (title != null || args.length > 0) {
        this._log('group', color.bold(format(title, ...args)));
      }
    }

    override groupCollapsed(title?: string, ...args: Array<unknown>): void {
      this._groupDepth++;

      if (title != null || args.length > 0) {
        this._log('groupCollapsed', color.bold(format(title, ...args)));
      }
    }

    override groupEnd(): void {
      if (this._groupDepth > 0) {
        this._groupDepth--;
      }
    }

    override info(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('info', format(firstArg, ...args));
    }

    override log(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('log', format(firstArg, ...args));
    }

    override time(label = 'default'): void {
      if (this._timers[label] != null) {
        return;
      }

      this._timers[label] = new RealDate();
    }

    override timeEnd(label = 'default'): void {
      const startTime = this._timers[label];

      if (startTime != null) {
        const endTime = RealDate.now();
        const time = endTime - startTime.getTime();
        this._log('time', format(`${label}: ${prettyTime(time)}`));
        delete this._timers[label];
      }
    }

    override timeLog(label = 'default', ...data: Array<unknown>): void {
      const startTime = this._timers[label];

      if (startTime != null) {
        const endTime = new RealDate();
        const time = endTime.getTime() - startTime.getTime();
        this._log('time', format(`${label}: ${prettyTime(time)}`, ...data));
      }
    }

    override warn(firstArg: unknown, ...args: Array<unknown>): void {
      this._log('warn', format(firstArg, ...args), 'stderr');
    }

    getBuffer(): undefined {
      return undefined;
    }
  }

  return new CustomConsole(process.stdout, process.stderr);
}
