import { installGracefulExit } from '../../../src/runtime/worker/setup';

/**
 * `installGracefulExit` replaced a bare `import './setup'` side effect so the
 * profiling SIGTERM handler survives `@rstest/core`'s `"sideEffects": false`
 * tree-shaking. These tests pin the handler-registration contract; the
 * used-binding call site in the worker entries is what keeps it in the bundle.
 */
describe('installGracefulExit', () => {
  const originalExecArgv = process.execArgv;

  afterEach(() => {
    process.execArgv = originalExecArgv;
  });

  const collectSignalListeners = (run: () => void): string[] => {
    const signals: string[] = [];
    const onSpy = rs
      .spyOn(process, 'on')
      .mockImplementation((event: string | symbol) => {
        signals.push(String(event));
        return process;
      });
    try {
      run();
    } finally {
      onSpy.mockRestore();
    }
    return signals;
  };

  it('registers the handler for every supported profiling flag', () => {
    for (const flag of [
      '--perf-basic-prof',
      '--prof',
      '--cpu-prof',
      '--heap-prof',
      '--diagnostic-dir=/tmp',
    ]) {
      process.execArgv = [flag];
      expect(collectSignalListeners(installGracefulExit)).toContain('SIGTERM');
    }
  });

  it('does not register a handler for a normal run', () => {
    process.execArgv = ['--enable-source-maps'];
    expect(collectSignalListeners(installGracefulExit)).not.toContain(
      'SIGTERM',
    );
  });
});
