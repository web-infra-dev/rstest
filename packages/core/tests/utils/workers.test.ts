import {
  getHostExecArgv,
  isVmPoolType,
  parseMemoryLimit,
} from '../../src/utils/workers';

describe('isVmPoolType', () => {
  it('recognizes both VM pools', () => {
    expect(isVmPoolType('vmForks')).toBe(true);
    expect(isVmPoolType('vmThreads')).toBe(true);
  });

  it('does not classify transport-only pools as VM pools', () => {
    expect(isVmPoolType('forks')).toBe(false);
    expect(isVmPoolType('threads')).toBe(false);
    expect(isVmPoolType(undefined)).toBe(false);
  });
});

describe('parseMemoryLimit', () => {
  const totalMemory = 8 * 1024 ** 3;

  it('resolves numeric fractions and byte values', () => {
    expect(parseMemoryLimit(0.5, totalMemory)).toBe(totalMemory / 2);
    expect(parseMemoryLimit(256.9, totalMemory)).toBe(256);
  });

  it('resolves percentages and decimal or binary units', () => {
    expect(parseMemoryLimit('25%', totalMemory)).toBe(totalMemory / 4);
    expect(parseMemoryLimit('256MB', totalMemory)).toBe(256 * 1000 ** 2);
    expect(parseMemoryLimit('256 MiB', totalMemory)).toBe(256 * 1024 ** 2);
    expect(parseMemoryLimit('1GB', totalMemory)).toBe(1000 ** 3);
    expect(parseMemoryLimit('1GiB', totalMemory)).toBe(1024 ** 3);
  });

  it('rejects invalid and non-positive limits', () => {
    expect(() => parseMemoryLimit(0, totalMemory)).toThrow(
      'pool.memoryLimit must be greater than 0',
    );
    expect(() => parseMemoryLimit('0MB', totalMemory)).toThrow(
      'pool.memoryLimit must be greater than 0',
    );
    expect(() => parseMemoryLimit('invalid', totalMemory)).toThrow(
      'Invalid pool.memoryLimit: invalid',
    );
  });
});

describe('getHostExecArgv', () => {
  // [host tokens, kept for forks, kept for threads]; threads rows match a
  // `new Worker({ execArgv })` probe on Node 22 and 24.
  const cases: [string[], boolean, boolean][] = [
    [['--import', 'x'], true, true],
    [['--import=x'], true, true],
    [['--require', 'x'], true, true],
    [['--require=x'], true, true],
    [['-r', 'x'], true, true],
    [['-r=x'], true, false],
    [['--loader', 'x'], true, true],
    [['--experimental-loader=x'], true, true],
    [['--conditions', 'dev'], true, true],
    [['--conditions=dev'], true, true],
    [['-C', 'dev'], true, true],
    [['-C=dev'], true, false],
    [['--preserve-symlinks'], true, true],
    [['--preserve-symlinks-main'], true, true],
    [['--env-file', '.env'], true, true],
    [['--env-file=.env'], true, true],
    [['--experimental-strip-types'], true, true],
    [['--no-experimental-strip-types'], true, true],
    [['--experimental-transform-types'], true, true],
    [['--experimental-detect-module'], true, true],
    [['--no-experimental-detect-module'], true, true],
    [['--experimental-require-module'], true, true],
    [['--no-experimental-require-module'], true, true],
    [['--experimental-wasm-modules'], true, true],
    [['--experimental-vm-modules'], true, true],
    [['--experimental-import-meta-resolve'], true, true],
    [['--experimental-default-type=module'], true, false],
    [['--input-type=module'], true, false],
    [['--no-warnings'], true, true],
    [['--trace-warnings'], true, true],
    [['--disable-warning', 'ExperimentalWarning'], true, true],
    [['--disable-warning=ExperimentalWarning'], true, true],
    [['--enable-source-maps'], true, true],
    [['--unhandled-rejections', 'strict'], true, true],
    [['--unhandled-rejections=strict'], true, true],
    [['--trace-uncaught'], true, true],
    [['--trace-deprecation'], true, true],
    [['--no-deprecation'], true, true],
    [['--throw-deprecation'], true, true],
    [['--pending-deprecation'], true, true],
    [['--diagnostic-dir', 'd'], true, true],
    [['--cpu-prof', '--cpu-prof-dir', 'd', '--cpu-prof-name=n'], true, true],
    [['--cpu-prof-interval=1000'], true, true],
    [['--heap-prof', '--heap-prof-dir=d', '--heap-prof-name', 'n'], true, true],
    [['--heap-prof-interval', '1000'], true, true],
    [['--max-old-space-size=512'], true, false],
    [['--expose-gc'], true, false],
    [['--stack-trace-limit=50'], true, false],
    [['--inspect=127.0.0.1:9229'], false, false],
    [['--inspect-brk'], false, false],
    [['--inspect-port', '9229'], false, false],
    [['--debug-port=9229'], false, false],
    [['--prof'], false, false],
    [['--title', 'foo'], false, false],
  ];

  for (const [argv, forks, threads] of cases) {
    it(argv.join(' '), () => {
      expect(getHostExecArgv('forks', argv)).toEqual(forks ? argv : []);
      expect(getHostExecArgv('threads', argv)).toEqual(threads ? argv : []);
    });
  }
});
