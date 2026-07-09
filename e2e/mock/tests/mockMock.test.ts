import { beforeEach, describe, expect, it, rs } from '@rstest/core';

rs.mock('../src/increment', { mock: true });

describe('rs.mock with { mock: true }', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should automock the module with mock functions', async () => {
    const { increment } = await import('../src/increment');

    // Functions should be mocks (not preserving original implementation)
    expect(rs.isMockFunction(increment)).toBe(true);

    // Mock functions should return undefined by default
    expect(increment(5)).toBeUndefined();
  });

  it('should track calls on mock functions', async () => {
    const { increment } = await import('../src/increment');

    increment(1);
    increment(3);

    expect(increment).toHaveBeenCalledTimes(2);
    expect(increment).toHaveBeenCalledWith(1);
    expect(increment).toHaveBeenCalledWith(3);
  });

  it('should allow configuring mock return values', async () => {
    const { increment } = await import('../src/increment');

    // Configure mock implementations
    (increment as ReturnType<typeof rs.fn>).mockReturnValue(100);

    expect(increment(1)).toBe(100);
    expect(increment(999)).toBe(100);
  });

  it('should allow configuring mock implementations', async () => {
    const { increment } = await import('../src/increment');

    // Configure mock implementations
    (increment as ReturnType<typeof rs.fn>).mockImplementation(
      (n: number) => n * 10,
    );

    expect(increment(5)).toBe(50);
    expect(increment(7)).toBe(70);
  });
});
