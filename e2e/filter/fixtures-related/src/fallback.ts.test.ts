import { expect, it } from '@rstest/core';
import { unrelated } from './unrelated';

it('should not be selected by substring-only fallback matching', () => {
  expect(unrelated()).toBe('unrelated');
});
