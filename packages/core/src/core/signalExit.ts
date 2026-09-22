import type { InternalContext } from '../types';
import { color, logger } from '../utils/logger';
import { onFatalSignal, getSignalExitCode } from '../utils/signals';

const logCleanupError = (error: unknown) => {
  logger.log(color.red(`Error during cleanup: ${error}`));
};

export function registerFatalSignalExit(
  context: Pick<InternalContext, 'embedded' | 'exitCode'>,
  {
    interrupt,
    release,
  }: {
    interrupt?: () => Promise<void>;
    release: () => Promise<void>;
  },
): () => void {
  if (context.embedded) return () => {};
  let interrupted = false;
  const onSignal = async (signal: NodeJS.Signals) => {
    const code = getSignalExitCode(signal);
    if (interrupted) {
      return process.exit(code);
    }
    interrupted = true;
    context.exitCode.raise(code);
    logger.log(color.yellow(`\nReceived ${signal}, cleaning up...`));
    await interrupt?.().catch(logCleanupError);
    await release().catch(logCleanupError);
    process.exit(context.exitCode.current);
  };
  return onFatalSignal(onSignal);
}
