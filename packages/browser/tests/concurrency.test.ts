import { describe, expect, it } from '@rstest/core';
import {
  getHeadlessConcurrency,
  parseWorkers,
  resolveDefaultHeadlessWorkers,
} from '../src/concurrency';

describe('headless concurrency', () => {
  it('should parse percentage workers', () => {
    expect(parseWorkers('50%', 8)).toBe(4);
    expect(parseWorkers('1%', 8)).toBe(1);
  });

  it('should parse numeric workers', () => {
    expect(parseWorkers(4, 16)).toBe(4);
    expect(parseWorkers(0, 16)).toBe(1);
  });

  it('should resolve default watch workers', () => {
    expect(resolveDefaultHeadlessWorkers('watch', 10)).toBe(4);
  });

  it('should resolve default run workers', () => {
    expect(resolveDefaultHeadlessWorkers('run', 10)).toBe(9);
  });

  it('should respect pool.maxWorkers when provided', () => {
    const context = {
      command: 'run',
      normalizedConfig: {
        pool: {
          // Use numeric workers here to avoid host CPU-dependent percentage variance.
          maxWorkers: 8,
        },
      },
    } as const;

    expect(getHeadlessConcurrency(context, 3)).toBe(3);
  });
});
