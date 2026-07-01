import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from '@rstest/core';

// Regression test for #1455: `new URL(<relative literal>, import.meta.url)`
// must resolve at runtime relative to the source module, instead of being
// rewritten by Rspack into a hashed bundled asset path.
it('resolves a sibling file via new URL(..., import.meta.url)', () => {
  const siblingPath = fileURLToPath(new URL('./sibling.txt', import.meta.url));
  expect(siblingPath).toMatch(/[\\/]new-url[\\/]sibling\.txt$/);
  expect(readFileSync(siblingPath, 'utf8')).toBe('hello');
});
