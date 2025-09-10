import { expect, it } from '@rstest/core';
import { lodash, VERSION } from './test-pkg/importLodash';

it('should load lodash correctly', () => {
  expect(lodash.VERSION).toBe(VERSION);
});
