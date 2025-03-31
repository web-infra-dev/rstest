import type { TestSuite } from 'src/types';

export type Awaitable<T> = T | PromiseLike<T>;

export type BeforeAllListener = (
  suite: Readonly<TestSuite | File>,
) => Awaitable<unknown>;

export type AfterAllListener = (
  suite: Readonly<TestSuite | File>,
) => Awaitable<unknown>;

// export function beforeAll(fn: BeforeAllListener, timeout?: number): void {
//   return getCurrentSuite().on('beforeAll', fn);
// }
