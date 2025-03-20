import type { TestCase } from '../types';

let _test: TestCase | undefined;

export function setCurrentTest<T extends TestCase>(test: T | undefined): void {
  _test = test;
}

export function getCurrentTest<T extends TestCase | undefined>(): T {
  return _test as T;
}
