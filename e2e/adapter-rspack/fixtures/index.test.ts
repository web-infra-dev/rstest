import { expect, it } from '@rstest/core';

const externalPath: typeof import('node:path') = require('strip-ansi');
const {
  default: fallbackValue,
}: { default: string } = require('adapter-fallback');
const {
  default: tsconfigReferenceValue,
}: { default: string } = require('adapter-tsconfig-reference');

it('applies Rspack externals', () => {
  expect(externalPath.basename('/tmp/example.ts')).toBe('example.ts');
});

it('applies Rspack-only resolve options', () => {
  expect(fallbackValue).toBe('resolved by Rspack fallback');
});

it('applies resolve.tsConfig references', () => {
  expect(tsconfigReferenceValue).toBe('resolved by Rspack fallback');
});
