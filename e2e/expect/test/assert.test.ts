import { assert, it } from '@rstest/core';

it('assert', () => {
  assert(
    'hello world'.includes('world'),
    'Expected "hello world" to include "world"',
  );
});
