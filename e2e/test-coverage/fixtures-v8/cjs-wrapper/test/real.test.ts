import { expect, it } from '@rstest/core';
import { Service, calls } from '../src/service';

it('calls the original implementation once', async () => {
  expect(await new Service().getInfo()).toBe('original');
  expect(calls).toBe(1);
});
