import { flushOutputStreams, logger } from '../utils/logger';

export const scheduleHostExit = async (timeoutMs: number): Promise<void> => {
  if (timeoutMs === 0) {
    await flushOutputStreams();
    return process.exit();
  }

  setTimeout(async () => {
    await flushOutputStreams();
    logger.warn(
      `The process did not exit ${timeoutMs}ms after the run finished, force exiting. Something is still running in the Rstest process, for example an open server, socket or timer created by a reporter, a plugin or the config file. Set \`teardownTimeout: 0\` to exit immediately after a run.`,
    );
    await flushOutputStreams();
    process.exit();
  }, timeoutMs).unref();
};
