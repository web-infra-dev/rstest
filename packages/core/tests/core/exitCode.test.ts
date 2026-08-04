import { createRunExitCode } from '../../src/core/exitCode';

describe('createRunExitCode', () => {
  it('starts with no code', () => {
    expect(createRunExitCode().current).toBeUndefined();
  });

  it('records a success as an explicit zero', () => {
    const exitCode = createRunExitCode();
    exitCode.raise(0);
    expect(exitCode.current).toBe(0);
  });

  it('never downgrades a non-zero code to zero', () => {
    // The `passWithNoTests` path raises 0 on a run that already failed; the
    // failure has to win, exactly as the replaced `process.exitCode` guard did.
    const exitCode = createRunExitCode();
    exitCode.raise(1);
    exitCode.raise(0);
    expect(exitCode.current).toBe(1);
  });

  it('upgrades a zero to a later non-zero code', () => {
    const exitCode = createRunExitCode();
    exitCode.raise(0);
    exitCode.raise(1);
    expect(exitCode.current).toBe(1);
  });

  it('notifies change listeners only when the held code actually changes', () => {
    const exitCode = createRunExitCode();
    const seen: number[] = [];
    exitCode.onChange((code) => seen.push(code));

    exitCode.raise(1);
    // Blocked by never-downgrade, then a redundant re-raise of the held code.
    exitCode.raise(0);
    exitCode.raise(1);

    expect(seen).toEqual([1]);
  });

  it('resets so the next cycle starts from its own code', () => {
    // The reusable runner and watch hold one context across many cycles: a
    // failing run must not pin every later run on the same context.
    const exitCode = createRunExitCode();
    exitCode.raise(1);
    exitCode.reset();
    expect(exitCode.current).toBeUndefined();

    exitCode.raise(0);
    expect(exitCode.current).toBe(0);
  });

  it('reports a completed cycle to its cycle-end listeners', () => {
    const exitCode = createRunExitCode();
    const codesAtCycleEnd: (number | undefined)[] = [];
    exitCode.onCycleEnd(() => codesAtCycleEnd.push(exitCode.current));

    exitCode.raise(1);
    exitCode.endCycle();
    exitCode.reset();
    exitCode.endCycle();

    expect(codesAtCycleEnd).toEqual([1, undefined]);
  });
});
