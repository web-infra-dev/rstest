import { expect, it } from '@rstest/core';

it('test jest error', () => {
  const fn = jest.fn();
  fn();
  expect(fn).toHaveBeenCalledTimes(1);
});
