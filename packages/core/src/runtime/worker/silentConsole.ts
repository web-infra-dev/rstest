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

const getFileTaskId = (testPath: string): string => {
  return `file:${testPath}`;
};

const getSuiteChainKey = (names: string[]): string => {
  return names.join('\u0000');
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
  const suiteIdsByChain = new Map<string, string>();

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

        if (log.taskType === 'suite' && log.taskId) {
          suiteIdsByChain.set(
            getSuiteChainKey([
              ...(log.taskParentNames || []),
              log.taskName || '',
            ]),
            log.taskId,
          );
        }

        return;
      }

      emitLog(log);
    },
    flushBufferedLogsForTask({
      taskId,
      status,
      taskParentNames,
      taskType,
      testPath,
    }: {
      taskId: string;
      status: 'skip' | 'pass' | 'fail' | 'todo';
      taskParentNames?: string[];
      taskType?: 'file' | 'suite' | 'case';
      testPath: string;
    }): void {
      if (status !== 'fail') {
        bufferedConsoleLogs.delete(taskId);
        return;
      }

      const taskIdsToFlush = new Set<string>([taskId]);

      if (taskType === 'case') {
        taskIdsToFlush.add(getFileTaskId(testPath));

        const suiteNames = taskParentNames || [];
        for (let i = 0; i < suiteNames.length; i++) {
          const suiteId = suiteIdsByChain.get(
            getSuiteChainKey(suiteNames.slice(0, i + 1)),
          );

          if (suiteId) {
            taskIdsToFlush.add(suiteId);
          }
        }
      }

      if (taskType === 'suite') {
        taskIdsToFlush.add(getFileTaskId(testPath));
      }

      for (const bufferedTaskId of taskIdsToFlush) {
        const logs = bufferedConsoleLogs.get(bufferedTaskId);
        if (!logs) {
          continue;
        }

        bufferedConsoleLogs.delete(bufferedTaskId);

        for (const log of logs) {
          emitLog(log);
        }
      }
    },
  };
};
