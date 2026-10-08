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
  // [host tokens, kept for forks, kept for threads]
  const cases: [string[], boolean, boolean][] = [
    [['--cpu-prof', '--cpu-prof-dir', 'd', '--cpu-prof-name=n'], true, true],
    [['--cpu-prof-interval=1000'], true, true],
    [['--heap-prof', '--heap-prof-dir=d', '--heap-prof-name', 'n'], true, true],
    [['--heap-prof-interval', '1000'], true, true],
    [['--diagnostic-dir', 'd'], true, true],
    [['--permission'], true, true],
    [['--experimental-permission'], true, true],
    [['--allow-fs-read=/data'], true, true],
    [['--allow-fs-read', '/data'], true, true],
    [['--allow-fs-write=/data'], true, true],
    [['--allow-worker', '--allow-child-process'], true, true],
    [['--allow-addons', '--allow-wasi'], true, true],
    [['--import', 'x'], true, false],
    [['-r', 'x'], true, false],
    [['--conditions=dev'], true, false],
    [['--experimental-strip-types'], true, false],
    [['--enable-source-maps'], true, false],
    [['--disable-warning', 'ExperimentalWarning'], true, false],
    [['--env-file', '.env'], true, false],
    [['--max-old-space-size=512'], true, false],
    [['--expose-gc'], true, false],
    [['--allow-natives-syntax'], true, false],
    [['--inspect=127.0.0.1:9229'], false, false],
    [['--inspect-brk'], false, false],
    [['--inspect-port', '9229'], false, false],
    [['--inspect-publish-uid', 'stderr'], false, false],
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
