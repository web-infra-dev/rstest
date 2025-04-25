import { expect, it, rstest } from '@rstest/core';

rstest.mock('../src/b', () => {
  return {
    b: 3,
  };
});

it.todo('should mock relative path module correctly', async () => {
  const { b } = await import('../src/index');
  expect(b).toBe(3);
});
