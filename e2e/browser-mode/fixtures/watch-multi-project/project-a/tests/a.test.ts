import { expect, it } from '@rstest/core';
import { messageA } from '../src/helper';

it('project a helper', () => {
  expect(messageA()).toBe('alpha');
});
