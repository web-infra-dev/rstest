import { expect, it, rs } from '@rstest/core';
import { Service, calls } from '../src/service';

it('does not count a replaced implementation', async () => {
  const spy = rs.spyOn(Service.prototype, 'getInfo').mockResolvedValue('mock');
  expect(await new Service().getInfo()).toBe('mock');
  expect(calls).toBe(0);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
