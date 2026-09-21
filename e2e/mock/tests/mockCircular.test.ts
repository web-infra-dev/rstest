import { expect, it, rs } from '@rstest/core';

rs.mock('../src/mockCircularTarget', { mock: true });

it('preserves partial exports while evaluating an auto-mock target', async () => {
  const { result } = await import('../src/mockCircularTarget');

  expect(result).toBe('target');
});
