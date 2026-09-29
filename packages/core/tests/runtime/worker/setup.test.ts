import { readFileSync, writeFileSync } from 'node:fs';
import {
  installGracefulExit,
  preferAsOomVictim,
} from '../../../src/runtime/worker/setup';

rs.mock('node:fs', () => ({ readFileSync: rs.fn(), writeFileSync: rs.fn() }));

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

describe('preferAsOomVictim', () => {
  beforeEach(() => {
    rs.stubGlobal(
      'process',
      Object.create(process, { platform: { value: 'linux' } }),
    );
    rs.mocked(writeFileSync).mockClear();
  });

  afterEach(() => {
    rs.unstubAllGlobals();
  });

  it.each([
    ['0\n', '1000'],
    ['-500\n', '500'],
    ['-997\n', '3'],
    ['300\n', '1000'],
  ])('raises an inherited %j to %s', (inherited, target) => {
    rs.mocked(readFileSync).mockReturnValue(inherited);
    preferAsOomVictim();
    expect(writeFileSync).toHaveBeenCalledExactlyOnceWith(
      '/proc/self/oom_score_adj',
      target,
    );
  });

  it('keeps a score already at 1000', () => {
    rs.mocked(readFileSync).mockReturnValue('1000\n');
    preferAsOomVictim();
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
