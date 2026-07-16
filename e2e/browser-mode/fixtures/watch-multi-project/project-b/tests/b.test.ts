import { expect, it } from '@rstest/core';
import { messageB } from '../src/helper';

it('project b helper', () => {
  expect(messageB()).toBe('bravo');
});
