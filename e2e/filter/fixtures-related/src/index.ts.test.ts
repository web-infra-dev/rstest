import { expect, it } from '@rstest/core';
import { unrelated } from './unrelated';

it('should not be selected by substring-only related matching', () => {
  expect(unrelated()).toBe('unrelated');
});
