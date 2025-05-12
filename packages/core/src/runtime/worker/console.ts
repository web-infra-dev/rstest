import { Console } from 'node:console';
import { format } from 'node:util';
import type { WorkerRPC } from './rpc';

export function createCustomConsole(rpc: WorkerRPC): Console {
  class CustomConsole extends Console {
    override log(firstArg: unknown, ...args: Array<unknown>) {
      rpc.onConsoleLog({ content: format(firstArg, ...args) });
    }
  }

  return new CustomConsole(process.stdout, process.stderr);
}
