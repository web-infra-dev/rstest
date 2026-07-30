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

let reportedFatalExit = false;

/**
 * Exit for a reason already reported to the user. A `process.exit` skips every
 * `finally`, so a run that had installed a `process.on('exit')` net cannot take
 * it down first — and that net exists to explain an exit nobody explained,
 * which this is the opposite of. Marking the exit is what keeps it from
 * printing "Rstest exited unexpectedly" underneath an actionable error and
 * overwriting the code with 1.
 *
 * A function declaration, not an arrow: control-flow analysis only treats a
 * `never`-returning call as terminating the branch for a declared function, so
 * callers keep the unreachable-code narrowing they had from `process.exit`.
 */
export function exitAfterReporting(code: number): never {
  reportedFatalExit = true;
  process.exit(code);
}

/** Whether {@link exitAfterReporting} is why this process is going down. */
export const hasReportedFatalExit = (): boolean => reportedFatalExit;
