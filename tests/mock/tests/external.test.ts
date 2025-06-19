import { expect, it, rs } from '@rstest/core';

rs.mock('picocolors', () => {
  return {
    sayHi: () => 'hi',
  };
});

// TODO
it.todo('should mock external module correctly', async () => {
  // @ts-expect-error
  const { sayHi } = await import('picocolors');

  expect(sayHi?.()).toBe('hi');
});
