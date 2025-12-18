import { expect, it, rstest } from '@rstest/core';

it('rstest.fn -> mock.invocationCallOrder', () => {
  rstest.resetAllMocks();
  const sayHi = rstest.fn();
  const sayHello = rstest.fn();

  sayHi();
  sayHello();
  sayHi();

  expect(sayHi.mock.invocationCallOrder).toEqual([1, 3]);
  expect(sayHello.mock.invocationCallOrder).toEqual([2]);
});
