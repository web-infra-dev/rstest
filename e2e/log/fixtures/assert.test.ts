import { test } from '@rstest/core';

test('assert output', () => {
  console.assert(false, 'expected %d items, got %d', 3, 2);
  console.assert(false, 'missing', { id: 1 });
  console.assert(false, new Error('boom'));
  console.assert(true, 'not printed');
});
