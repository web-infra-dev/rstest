import { beforeEach, describe, expect, it, rs } from '@rstest/core';

import { increment } from '../src/increment';

rs.mock('../src/increment');

describe('rs.mock without factory fallback automock', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('falls back to automock when no manual mock exists', () => {
    expect(rs.isMockFunction(increment)).toBe(true);
    expect(increment(1)).toBeUndefined();

    rs.mocked(increment).mockReturnValue(100);

    expect(increment(1)).toBe(100);
    expect(increment).toHaveBeenCalledWith(1);
  });
});
