import { expect, it } from '@rstest/core';
import { foo } from 'demo-lib';

it('transformImport from rstest config', () => {
  expect(foo()).toBe('actual');
});
