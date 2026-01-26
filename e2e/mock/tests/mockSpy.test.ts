import { describe, expect, rs, test } from '@rstest/core';
import { increment } from '../src/increment';

rs.mock('../src/increment', { spy: true });

describe('rs.mock with { spy: true }', () => {
  test('preserves original implementation', () => {
    // Original implementation should still work
    expect(increment(1)).toBe(2);
    expect(increment(5)).toBe(6);
  });

  test('tracks function calls', () => {
    increment(10);

    // Should be able to assert on calls
    expect(increment).toHaveBeenCalled();
    expect(increment).toHaveBeenCalledWith(10);
  });

  test('tracks return values', () => {
    const result = increment(100);

    expect(result).toBe(101);
    expect(increment).toHaveReturnedWith(101);
  });

  test('exports are mock functions', () => {
    expect(rs.isMockFunction(increment)).toBe(true);
  });

  test('can override implementation with mockImplementation', () => {
    // Override the implementation
    rs.mocked(increment).mockImplementation((num: number) => num + 100);

    // Now it should use the mocked implementation
    expect(increment(1)).toBe(101);
    expect(increment(5)).toBe(105);

    // Still tracks calls
    expect(increment).toHaveBeenCalledWith(1);
    expect(increment).toHaveBeenCalledWith(5);
  });

  test('can use mockImplementationOnce', () => {
    // Reset to clear previous mockImplementation
    rs.mocked(increment).mockReset();

    // Set up one-time implementations
    rs.mocked(increment).mockImplementationOnce((num: number) => num * 10);
    rs.mocked(increment).mockImplementationOnce((num: number) => num * 20);

    // First call uses first mockImplementationOnce
    expect(increment(5)).toBe(50);
    // Second call uses second mockImplementationOnce
    expect(increment(5)).toBe(100);
    // Third call falls back to original implementation (spy mode preserves it)
    expect(increment(5)).toBe(6);
  });

  test('mockReturnValue works with spy mode', () => {
    rs.mocked(increment).mockReturnValue(999);

    expect(increment(1)).toBe(999);
    expect(increment(100)).toBe(999);

    // Still tracks the calls
    expect(increment).toHaveBeenCalledWith(1);
    expect(increment).toHaveBeenCalledWith(100);
  });

  test('mockReturnValueOnce works with spy mode', () => {
    rs.mocked(increment).mockClear();
    rs.mocked(increment).mockReturnValueOnce(111);
    rs.mocked(increment).mockReturnValueOnce(222);

    expect(increment(1)).toBe(111);
    expect(increment(1)).toBe(222);
    // Falls back to previous mockReturnValue(999)
    expect(increment(1)).toBe(999);
  });

  test('mockReset restores original implementation in spy mode', () => {
    // Reset to restore original implementation
    rs.mocked(increment).mockReset();

    // Now it should use the original implementation again
    expect(increment(1)).toBe(2);
    expect(increment(5)).toBe(6);
  });
});

describe('rs.mock with { spy: true } and unmock', () => {
  test('unmock restores original module after mockImplementation', async () => {
    // First verify it's mocked
    expect(rs.isMockFunction(increment)).toBe(true);

    // Override implementation
    rs.mocked(increment).mockImplementation((num: number) => num * 1000);
    expect(increment(5)).toBe(5000);

    // Unmock the module
    rs.doUnmock('../src/increment');

    // Re-import the module
    const { increment: originalIncrement } = await import('../src/increment');

    // Original implementation should work (not the mockImplementation)
    expect(originalIncrement(1)).toBe(2);
    expect(originalIncrement(5)).toBe(6);

    // It should no longer be a mock function
    expect(rs.isMockFunction(originalIncrement)).toBe(false);
  });
});
