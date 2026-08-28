import { parseVmMemoryLimit } from '../../src/utils/workers';

describe('parseVmMemoryLimit', () => {
  const totalMemory = 8 * 1024 ** 3;

  it('resolves numeric fractions and byte values', () => {
    expect(parseVmMemoryLimit(0.5, totalMemory)).toBe(totalMemory / 2);
    expect(parseVmMemoryLimit(256.9, totalMemory)).toBe(256);
  });

  it('resolves percentages and decimal or binary units', () => {
    expect(parseVmMemoryLimit('25%', totalMemory)).toBe(totalMemory / 4);
    expect(parseVmMemoryLimit('256MB', totalMemory)).toBe(256 * 1000 ** 2);
    expect(parseVmMemoryLimit('256 MiB', totalMemory)).toBe(256 * 1024 ** 2);
    expect(parseVmMemoryLimit('1GB', totalMemory)).toBe(1000 ** 3);
    expect(parseVmMemoryLimit('1GiB', totalMemory)).toBe(1024 ** 3);
  });

  it('rejects invalid and non-positive limits', () => {
    expect(() => parseVmMemoryLimit(0, totalMemory)).toThrow(
      'pool.vmMemoryLimit must be greater than 0',
    );
    expect(() => parseVmMemoryLimit('0MB', totalMemory)).toThrow(
      'pool.vmMemoryLimit must be greater than 0',
    );
    expect(() => parseVmMemoryLimit('invalid', totalMemory)).toThrow(
      'Invalid pool.vmMemoryLimit: invalid',
    );
  });
});
