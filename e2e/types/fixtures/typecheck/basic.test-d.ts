import {
  assertType,
  describe,
  expectTypeOf,
  test as check,
} from '@rstest/typecheck';
import { twice } from './source.js';

function mustNotExecute(): void {
  throw new Error('Type tests must never execute');
}
mustNotExecute();

describe('type assertions', () => {
  check('return type', () => {
    expectTypeOf(twice).returns.toEqualTypeOf<number>();
    assertType<number>(twice(2));
    // @ts-expect-error Reject a string argument.
    twice('2');
  });

  describe('nested', () => {
    check(`literal name`, () => {
      expectTypeOf<never>().toBeNever();
      expectTypeOf<unknown>().toBeUnknown();
      expectTypeOf<{ name: string }>().toExtend<{ name: string }>();
    });
  });
});
