import { afterAll, expect, it, rs } from '@rstest/core';

rs.doMock('../src/sideEffects', () => {
  return {
    a: 2,
  };
});

afterAll(() => {
  rs.doUnmock('../src/sideEffects');
});

it('mocked a', async () => {
  const { a } = await import('../src/sideEffects');
  expect(a).toBe(2);
  expect(process.env.a).toBeUndefined();
});
