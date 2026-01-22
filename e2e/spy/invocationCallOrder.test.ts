import { expect, it, rstest } from '@rstest/core';

it('rstest.fn -> mock.invocationCallOrder', () => {
  const sayHi = rstest.fn();
  const sayHello = rstest.fn();

  sayHi();
  sayHello();
  sayHi();

  expect(sayHi.mock.invocationCallOrder).toEqual([1, 3]);
  expect(sayHello.mock.invocationCallOrder).toEqual([2]);

  rstest.restoreAllMocks();

  sayHi();
  expect(sayHi.mock.invocationCallOrder).toEqual([4]);
});
