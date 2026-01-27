import { beforeEach, describe, expect, rs, test } from '@rstest/core';

describe('rs.doMock with { mock: true }', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  test('doMock with mock creates mock functions', async () => {
    rs.doMock('../src/increment', { mock: true });

    const { increment } = await import('../src/increment');

    // Original implementation should NOT work (returns undefined)
    expect(increment(1)).toBeUndefined();
    expect(increment(5)).toBeUndefined();

    // Should be a mock function
    expect(rs.isMockFunction(increment)).toBe(true);

    // Should track calls
    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith(1);
    expect(increment).toHaveBeenCalledWith(5);
  });

  test('doMock with mock can configure return values', async () => {
    rs.doMock('../src/increment', { mock: true });

    const { increment } = await import('../src/increment');

    // Configure mock return value
    rs.mocked(increment).mockReturnValue(999);
    expect(increment(5)).toBe(999);
    expect(increment(100)).toBe(999);

    // Configure mock implementation
    rs.mocked(increment).mockImplementation((n: number) => n * 3);
    expect(increment(10)).toBe(30);
  });
});
