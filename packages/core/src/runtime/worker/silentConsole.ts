import type { RuntimeConfig, UserConsoleLog } from '../../types';

type ConsoleWriter = (payload: {
  content: string;
  type: 'stderr' | 'stdout';
}) => void;

const getBufferedLogTaskId = (log: UserConsoleLog): string => {
  if (log.taskId) {
    return log.taskId;
  }

  return `file:${log.testPath}`;
};

export const createSilentConsoleController = ({
  runtimeConfig,
  emitInterceptedLog,
  writeOriginalLog,
}: {
  runtimeConfig: Pick<RuntimeConfig, 'disableConsoleIntercept' | 'silent'>;
  emitInterceptedLog: (log: UserConsoleLog) => Promise<void> | void;
  writeOriginalLog: ConsoleWriter;
}) => {
  const bufferedConsoleLogs = new Map<string, UserConsoleLog[]>();

  const emitLog = (log: UserConsoleLog): void => {
    if (runtimeConfig.disableConsoleIntercept) {
      writeOriginalLog({
        content: `${log.content}\n`,
        type: log.type,
      });
      return;
    }

    emitInterceptedLog(log);
  };

  return {
    onConsoleLog(log: UserConsoleLog): void {
      if (runtimeConfig.silent === true) {
        return;
      }

      if (runtimeConfig.silent === 'passed-only') {
        const taskId = getBufferedLogTaskId(log);
        const logs = bufferedConsoleLogs.get(taskId) || [];
        logs.push(log);
        bufferedConsoleLogs.set(taskId, logs);
        return;
      }

      emitLog(log);
    },
    flushBufferedLogsForTask({
      taskId,
      status,
    }: {
      taskId: string;
      status: 'skip' | 'pass' | 'fail' | 'todo';
    }): void {
      const logs = bufferedConsoleLogs.get(taskId);
      if (!logs) {
        return;
      }

      bufferedConsoleLogs.delete(taskId);

      if (status !== 'fail') {
        return;
      }

      for (const log of logs) {
        emitLog(log);
      }
    },
  };
};
