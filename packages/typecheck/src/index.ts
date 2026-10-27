export { assertType, expectTypeOf, type ExpectTypeOf } from './assertions';

/** Register a static type test. Callbacks are checked without being executed. */
export function test(_name: string, _callback: () => void): void {
  throw new Error(
    '@rstest/typecheck registrations must be collected with typecheck enabled. They cannot run as runtime tests.',
  );
}

export const it: typeof test = test;
export const describe: typeof test = test;
