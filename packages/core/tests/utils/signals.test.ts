import { describe, expect, it, rs } from '@rstest/core';
import {
  exitAfterReporting,
  hasReportedFatalExit,
} from '../../src/utils/signals';

describe('exitAfterReporting', () => {
  it('marks the exit, so an unexpected-exit net can stay out of it', () => {
    // The browser loader exits this way once it has printed the install command
    // for a missing or mismatched `@rstest/browser`. `process.exit` skips every
    // `finally`, so the run's `process.on('exit')` net is still installed and
    // would print "Rstest exited unexpectedly" under an error the user can act
    // on — this flag is the only thing it can read to tell the two apart.
    expect(hasReportedFatalExit()).toBe(false);

    // Observed from inside the mocked exit: the real one never returns, and the
    // declaration says so, so anything written after the call is unreachable —
    // which is the property callers rely on and the compiler enforces here.
    let markedAtExit: boolean | undefined;
    let exitedWith: number | undefined;
    const exit = rs.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      exitedWith = code;
      markedAtExit = hasReportedFatalExit();
    }) as never);
    // Asserted in the `finally` for the same reason: the call type-checks as
    // never returning, so statements after the `try` are unreachable code.
    try {
      exitAfterReporting(1);
    } finally {
      exit.mockRestore();
      expect(exitedWith).toBe(1);
      expect(markedAtExit).toBe(true);
    }
  });
});
