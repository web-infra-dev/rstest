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
  it('drops inspector, --prof and --title flags for forks', () => {
    expect(
      getHostExecArgv('forks', [
        '--title',
        'foo',
        '--inspect-port',
        '9229',
        '--inspect=127.0.0.1:9229',
        '--prof',
        '--expose-gc',
      ]),
    ).toEqual(['--expose-gc']);
  });

  it('keeps only profiling and permission flags for threads', () => {
    expect(
      getHostExecArgv('threads', [
        '--cpu-prof',
        '--cpu-prof-dir',
        'd',
        '--allow-fs-read',
        '/a',
        '--permission',
        '--max-old-space-size=512',
        '--import',
        'x',
        '--allow-natives-syntax',
        '--allow_worker',
        '--heap_prof_dir=d',
      ]),
    ).toEqual([
      '--cpu-prof',
      '--cpu-prof-dir',
      'd',
      '--allow-fs-read',
      '/a',
      '--permission',
      '--allow_worker',
      '--heap_prof_dir=d',
    ]);
  });

  it('keeps a separate value with its option', () => {
    expect(
      getHostExecArgv('forks', [
        '--title',
        'foo',
        '-C',
        'dev',
        '--conditions=dev',
      ]),
    ).toEqual(['-C', 'dev', '--conditions=dev']);
  });
});
