import { expect, it, rstest } from '@rstest/core';

rstest.mock('picocolors', () => {
  return {
    sayHi: () => 'hi',
  };
});

it.todo('should mock external module correctly', async () => {
  // @ts-expect-error
  const { sayHi } = await import('picocolors');

  expect(sayHi?.()).toBe('hi');
});
