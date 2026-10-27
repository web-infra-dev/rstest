export { expectTypeOf, type ExpectTypeOf } from 'expect-type';

/** Assert assignability during type checking; has no runtime effect. */
export function assertType<T>(_value: T): void {}
