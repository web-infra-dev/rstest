import { expect, it } from '@rstest/core';
import { transitiveC } from './src/transitive-c';

it('reads the transitive module', () => {
  expect(transitiveC).toBe('c');
});
