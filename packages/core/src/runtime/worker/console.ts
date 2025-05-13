import { Console } from 'node:console';
import { format } from 'node:util';
import { color } from '../../utils';
import type { WorkerRPC } from './rpc';

export function createCustomConsole({
  rpc,
  testPath,
  printConsoleTrace,
}: { rpc: WorkerRPC; testPath: string; printConsoleTrace: boolean }): Console {
  const getConsoleTrace = () => {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 3;
    const stack = new Error('STACK_TRACE').stack;
    const trace = stack?.split('\n').slice(3).join('\n');
    Error.stackTraceLimit = limit;

    return trace;
  };
  class CustomConsole extends Console {
    override log(firstArg: unknown, ...args: Array<unknown>) {
      rpc.onConsoleLog({
        content: format(firstArg, ...args),
        trace: printConsoleTrace ? getConsoleTrace() : undefined,
        name: color.gray(color.bold('log')),
        testPath,
      });
    }
    override warn(firstArg: unknown, ...args: Array<unknown>) {
      rpc.onConsoleLog({
        content: format(firstArg, ...args),
        trace: printConsoleTrace ? getConsoleTrace() : undefined,
        name: color.yellow(color.bold('warn')),
        testPath,
      });
    }
    // todo: find a better way to override error, trace, info, debug, etc.
  }

  return new CustomConsole(process.stdout, process.stderr);
}
