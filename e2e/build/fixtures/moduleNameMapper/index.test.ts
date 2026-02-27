import { expect, it } from '@rstest/core';
// This should resolve to ./src/utils/helper.ts
// @ts-expect-error
import { helper } from '@utils/helper';
// This should resolve to module-b due to moduleNameMapper
// @ts-expect-error
import { value } from 'module-a';

it('moduleNameMapper should redirect module-a to module-b', () => {
  expect(value).toBe('module-b');
});

it('moduleNameMapper should support capture groups', () => {
  expect(helper).toBe('helper-function');
});
