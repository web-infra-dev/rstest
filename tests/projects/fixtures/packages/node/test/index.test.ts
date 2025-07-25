import { expect, it } from '@rstest/core';
import { sayHi } from '../src/index';

it('should test source code correctly', () => {
  expect(sayHi()).toBe('hi');
});

it('should can not get document', () => {
  expect(global.document).toBeUndefined();
});
