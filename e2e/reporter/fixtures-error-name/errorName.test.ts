import { it } from '@rstest/core';

it('wraps a cause whose name is not a string', () => {
  throw new Error('Failed to load user', {
    cause: { message: 'Database connection refused', name: 42 },
  });
});

it('throws an object whose name is not a string', () => {
  throw { message: 'Request failed', name: 42 };
});
