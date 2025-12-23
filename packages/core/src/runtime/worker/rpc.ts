import { type BirpcOptions, type BirpcReturn, createBirpc } from 'birpc';
import type { TinypoolWorkerMessage } from 'tinypool';
import type {
  RuntimeRPC,
  ServerRPC,
  TestCaseInfo,
  TestResult,
} from '../../types';

export type WorkerRPC = BirpcReturn<RuntimeRPC, ServerRPC>;

const processSend = process.send!.bind(process);
const processOn = process.on.bind(process);
const processOff = process.off.bind(process);
const dispose: (() => void)[] = [];

export type WorkerRpcOptions = Pick<
  BirpcOptions<ServerRPC>,
  'on' | 'post' | 'serialize' | 'deserialize'
>;

export function createForksRpcOptions(): WorkerRpcOptions {
  return {
    post(v) {
      processSend(v);
    },
    on(fn) {
      const handler = (message: any, ...extras: any) => {
        // Do not react on Tinypool's internal messaging
        if ((message as TinypoolWorkerMessage)?.__tinypool_worker_message__) {
          return;
        }
        return fn(message, ...extras);
      };
      processOn('message', handler);
      dispose.push(() => processOff('message', handler));
    },
  };
}

export function createRuntimeRpc(
  options: Pick<
    BirpcOptions<void>,
    'on' | 'post' | 'serialize' | 'deserialize'
  >,
  {
    originalConsole,
  }: {
    originalConsole: Console;
  },
): { rpc: WorkerRPC } {
  const rpc = createBirpc<RuntimeRPC, ServerRPC>(
    {},
    {
      ...options,
      onTimeoutError: (functionName, error) => {
        switch (functionName) {
          case 'onTestCaseStart': {
            const caseTest = error[0] as unknown as TestCaseInfo;
            console.error(
              `[Rstest] timeout on calling "onTestCaseStart" rpc method (Case: "${caseTest.name}")`,
            );
            return true;
          }
          case 'onTestCaseResult': {
            const caseResult = error[0] as unknown as TestResult;
            console.error(
              `[Rstest] timeout on calling "onTestCaseResult" rpc method (Case: "${caseResult.name}", Result: "${caseResult.status}")`,
            );
            return true;
          }
          case 'onConsoleLog': {
            originalConsole.error(
              `[Rstest] timeout on calling "onConsoleLog" rpc method (Original log: ${error[0].content})`,
            );
            return true;
          }
          default:
            return false;
        }
      },
    },
  );

  return {
    rpc,
  };
}
