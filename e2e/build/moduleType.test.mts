import { expect, it } from '@rstest/core';
// @ts-expect-error
import swc from './src/swc.js';

it('should treat mts as strict ES modules', async () => {
  expect(swc).toBeDefined();
  expect(swc.Compiler).toBeDefined();
});
