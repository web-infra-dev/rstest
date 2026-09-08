import { parseMemoryLimit } from '../../src/utils/workers';

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
