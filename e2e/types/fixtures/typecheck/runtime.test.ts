import { assertType, expectTypeOf, test } from '@rstest/core';

test('runtime assertions remain callable', () => {
  expectTypeOf(1).toEqualTypeOf<number>();
  assertType<number>(1);
});
