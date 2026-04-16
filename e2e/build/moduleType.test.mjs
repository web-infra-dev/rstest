import { expect, it } from '@rstest/core';
import swc from './src/swc.js';

it('should treat mjs as strict ES modules', async () => {
  expect(swc).toBeDefined();
  expect(swc.Compiler).toBeDefined();
});
