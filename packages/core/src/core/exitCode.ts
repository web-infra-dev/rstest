/**
 * The run's exit code, held as a value owned by one `RstestContext`.
 *
 * Deep layers (finalize, coverage thresholds, `globalSetup` teardown, blob
 * merge, list collection) raise failure here instead of writing
 * `process.exitCode`, so the engine never mutates process-global state: a
 * programmatic host's exit code stays untouched while tests run, and two
 * concurrent in-process runs cannot clobber each other. Only the CLI projects
 * this onto `process.exitCode`.
 */
export type RunExitCode = {
  /** Code raised so far in the current cycle; `undefined` when none was. */
  readonly current: number | undefined;
  /**
   * Record `code`. Never downgrades: a later zero (`passWithNoTests`) cannot
   * clear a non-zero code raised earlier in the same cycle.
   */
  raise: (code: number) => void;
  /** Drop the accumulated code so the next cycle starts from its own. */
  reset: () => void;
  /** Observe every raise that changes `current`. */
  onChange: (listener: (code: number) => void) => void;
  /**
   * Announce that one `finalizeRunCycle` finished. Coverage thresholds and
   * report-generation failures raise *after* the reporters were notified, so
   * this is the first point at which a per-run observer reads a complete code.
   */
  endCycle: () => void;
  /** Observe `endCycle`. */
  onCycleEnd: (listener: () => void) => void;
};

export const createRunExitCode = (): RunExitCode => {
  let current: number | undefined;
  const changeListeners: ((code: number) => void)[] = [];
  const cycleEndListeners: (() => void)[] = [];

  return {
    get current() {
      return current;
    },
    raise: (code) => {
      // Never downgrade: once a failure is raised, a later zero
      // (`passWithNoTests`) cannot clear it. Re-raising the code already held
      // is a no-op and must not re-notify.
      const canRaise = code !== 0 || current === undefined || current === 0;
      if (!canRaise || current === code) {
        return;
      }
      current = code;
      for (const listener of changeListeners) {
        listener(code);
      }
    },
    reset: () => {
      current = undefined;
    },
    onChange: (listener) => {
      changeListeners.push(listener);
    },
    endCycle: () => {
      for (const listener of cycleEndListeners) {
        listener();
      }
    },
    onCycleEnd: (listener) => {
      cycleEndListeners.push(listener);
    },
  };
};
