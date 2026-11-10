import type { RawUserConsoleLog, RuntimeConfig } from '../../types';
import { getFileTaskId } from '../../utils/helper';

type ConsoleWriter = (payload: {
  content: string;
  type: 'stderr' | 'stdout';
}) => void;

type BufferedLogTask = {
  taskId: string;
  status: 'skipped' | 'passed' | 'failed' | 'todo';
  taskParentNames?: string[];
  taskType?: 'file' | 'suite' | 'case';
  testPath: string;
  project: string;
  /** Browser rows only: the node pool's file id is just the test path. */
  browserName?: string;
};

const getBufferedLogTaskId = (log: RawUserConsoleLog): string =>
  log.taskId || getFileTaskId(log);

const getSuiteChainKey = (names: string[]): string => {
  return names.join('\u0000');
};

const pushTaskId = (taskIds: string[], taskId: string): void => {
  if (!taskIds.includes(taskId)) {
    taskIds.push(taskId);
  }
};

export const createSilentConsoleController = ({
  runtimeConfig,
  emitInterceptedLog,
  writeOriginalLog,
}: {
  runtimeConfig: Pick<RuntimeConfig, 'disableConsoleIntercept' | 'silent'>;
  emitInterceptedLog: (log: RawUserConsoleLog) => Promise<void> | void;
  writeOriginalLog: ConsoleWriter;
}): {
  onConsoleLog: (log: RawUserConsoleLog) => void;
  flushBufferedLogsForTask: (task: BufferedLogTask) => void;
} => {
  const emitLog = (log: RawUserConsoleLog): void => {
    if (runtimeConfig.disableConsoleIntercept) {
      writeOriginalLog({
        content: `${log.content}\n`,
        type: log.type,
      });
      return;
    }

    emitInterceptedLog(log);
  };

  if (runtimeConfig.silent !== 'passed-only') {
    return {
      onConsoleLog: runtimeConfig.silent === true ? () => {} : emitLog,
      flushBufferedLogsForTask: () => {},
    };
  }

  const bufferedConsoleLogs = new Map<string, RawUserConsoleLog[]>();
  const suiteIdsByChain = new Map<string, string>();

  return {
    onConsoleLog(log: RawUserConsoleLog): void {
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
    },
    flushBufferedLogsForTask({
      taskId,
      status,
      taskParentNames,
      taskType,
      testPath,
      project,
      browserName,
    }: BufferedLogTask): void {
      if (status !== 'failed') {
        bufferedConsoleLogs.delete(taskId);
        return;
      }

      const taskIdsToFlush: string[] = [];

      if (taskType === 'case') {
        pushTaskId(
          taskIdsToFlush,
          getFileTaskId({ project, testPath, browserName }),
        );

        const suiteNames = taskParentNames || [];
        for (let i = 0; i < suiteNames.length; i++) {
          const suiteId = suiteIdsByChain.get(
            getSuiteChainKey(suiteNames.slice(0, i + 1)),
          );

          if (suiteId) {
            pushTaskId(taskIdsToFlush, suiteId);
          }
        }

        pushTaskId(taskIdsToFlush, taskId);
      }

      if (taskType === 'suite') {
        pushTaskId(
          taskIdsToFlush,
          getFileTaskId({ project, testPath, browserName }),
        );
        pushTaskId(taskIdsToFlush, taskId);
      }

      if (taskType === 'file') {
        pushTaskId(taskIdsToFlush, taskId);
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
