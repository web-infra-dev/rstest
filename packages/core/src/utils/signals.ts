import { constants as osConstants } from 'node:os';

/** Signals every run path treats as fatal and cleans up on. */
export const FATAL_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGTSTP'] as const;

/**
 * POSIX-conventional exit code for a signal-terminated process: 128 + signal
 * number, falling back to 1 for unknown signals. Shared by the node watch
 * loop and the browser watch host so both report the same code.
 */
export const getSignalExitCode = (signal: NodeJS.Signals): number => {
  const signalNumber = osConstants.signals[signal];
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1;
};
