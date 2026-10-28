import { expect, it } from '@rstest/core';
import { transitiveB } from './src/transitive-b';

it('combines transitive inputs', () => {
  expect(transitiveB).toBe('a-b');
});
