import { test } from '@rstest/core';
import { assertType, expectTypeOf } from '@rstest/typecheck';

test('runtime assertions remain callable', () => {
  expectTypeOf(1).toEqualTypeOf<number>();
  assertType<number>(1);
});
