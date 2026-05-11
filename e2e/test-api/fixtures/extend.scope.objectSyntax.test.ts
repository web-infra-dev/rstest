import { expect, test } from '@rstest/core';

interface Pool {
  size: number;
}

const fileTest = test.extend<{ pool: Pool }>({
  pool: [
    async (_, use) => {
      console.log('[lifecycle] setup pool');
      const pool: Pool = { size: 4 };
      await use(pool);
      console.log('[lifecycle] teardown pool');
    },
    { scope: 'file' },
  ],
});

fileTest('first test uses pool', ({ pool }) => {
  console.log('[lifecycle] use test 1');
  expect(pool.size).toBe(4);
  // Mutating the shared pool to prove it is the same instance.
  pool.size = 5;
});

fileTest('second test sees the mutation', ({ pool }) => {
  console.log('[lifecycle] use test 2');
  expect(pool.size).toBe(5);
});
