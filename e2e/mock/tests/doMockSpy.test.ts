import { describe, expect, rs, test } from '@rstest/core';

describe('rs.doMock with { spy: true }', () => {
  test('doMock with spy preserves implementation and tracks calls', async () => {
    rs.doMock('../src/increment', { spy: true });

    const { increment } = await import('../src/increment');

    // Original implementation should work
    expect(increment(1)).toBe(2);
    expect(increment(5)).toBe(6);

    // Should be able to assert on calls
    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith(1);
    expect(increment).toHaveBeenCalledWith(5);
    expect(rs.isMockFunction(increment)).toBe(true);
  });

  test('doMock with spy can mock return values', async () => {
    rs.doMock('../src/increment', { spy: true });

    const { increment } = await import('../src/increment');

    // Mock the implementation temporarily
    rs.mocked(increment).mockReturnValueOnce(999);

    expect(increment(1)).toBe(999); // Mocked return
    expect(increment(1)).toBe(2); // Original implementation
  });
});
