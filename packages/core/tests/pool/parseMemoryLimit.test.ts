import os from 'node:os';
import { parseMemoryLimit } from '../../src/pool/parseMemoryLimit';

const MB = 1024 * 1024;
const SI_MB = 1_000_000;

describe('parseMemoryLimit', () => {
  describe('disable / falsy', () => {
    it.each([
      ['undefined', undefined],
      ['empty string', ''],
      ['gibberish', 'not-a-number'],
      ['negative number', -1],
      ['zero', 0],
      ['NaN', Number.NaN],
      ['infinity', Number.POSITIVE_INFINITY],
    ] as const)('returns 0 for %s', (_label, input) => {
      // `as any` because some inputs are deliberately outside the public type.
      expect(parseMemoryLimit(input as any)).toBe(0);
    });
  });

  describe('number form', () => {
    it('treats values > 1 as a byte count', () => {
      expect(parseMemoryLimit(2_000_000_000)).toBe(2_000_000_000);
    });

    it('treats values in (0, 1] as a fraction of total system memory', () => {
      const half = Math.floor(0.5 * os.totalmem());
      expect(parseMemoryLimit(0.5)).toBe(half);
    });

    it('treats exactly 1 as 100% of system memory', () => {
      expect(parseMemoryLimit(1)).toBe(os.totalmem());
    });

    it('floors fractional bytes (no half-bytes downstream)', () => {
      // 1.7 > 1 → interpreted as bytes; floored.
      expect(parseMemoryLimit(1.7)).toBe(1);
    });
  });

  describe('string with unit suffix', () => {
    it.each([
      // [input, expected bytes]
      ['512KB', 512 * 1e3],
      ['512kb', 512 * 1e3],
      ['512k', 512 * 1e3],
      ['512KiB', 512 * 1024],
      ['256MB', 256 * SI_MB],
      ['256mb', 256 * SI_MB],
      ['256m', 256 * SI_MB],
      ['256MiB', 256 * MB],
      ['1GB', 1e9],
      ['1.5GB', Math.floor(1.5 * 1e9)],
      ['1.5g', Math.floor(1.5 * 1e9)],
      ['1GiB', 1024 * 1024 * 1024],
    ])('parses %s', (input, expected) => {
      expect(parseMemoryLimit(input)).toBe(expected);
    });

    it('handles surrounding whitespace', () => {
      expect(parseMemoryLimit('  1GB  ')).toBe(1e9);
    });

    it('returns 0 for unknown units', () => {
      expect(parseMemoryLimit('5XB')).toBe(0);
    });

    it('returns 0 for negative numeric prefix', () => {
      expect(parseMemoryLimit('-5MB')).toBe(0);
    });
  });

  describe('string with percent suffix', () => {
    it('parses "20%" as a fraction of total system memory', () => {
      expect(parseMemoryLimit('20%')).toBe(Math.floor(0.2 * os.totalmem()));
    });

    it('parses "100%" as exactly 100% of system memory', () => {
      // floor of total since totalMemory is always an integer
      expect(parseMemoryLimit('100%')).toBe(os.totalmem());
    });

    it('parses fractional percent', () => {
      expect(parseMemoryLimit('12.5%')).toBe(Math.floor(0.125 * os.totalmem()));
    });
  });

  describe('string without unit (treated as number)', () => {
    it('parses a bare integer string as bytes', () => {
      expect(parseMemoryLimit('2000000000')).toBe(2_000_000_000);
    });

    it('parses a fractional bare string as a system-memory fraction', () => {
      expect(parseMemoryLimit('0.25')).toBe(Math.floor(0.25 * os.totalmem()));
    });
  });
});
