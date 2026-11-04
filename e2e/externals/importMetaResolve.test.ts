import { expect, it } from '@rstest/core';
import {
  getImportMetaResolve,
  resolveImportMeta,
} from './require-resolve-origin/index.js';

it('exposes import.meta.resolve as a stable function', () => {
  expect(typeof import.meta.resolve).toBe('function');
  const resolve = import.meta.resolve;
  expect(resolve).toBe(import.meta.resolve);
  expect(resolve('./importMetaResolve.test.ts')).toBe(import.meta.url);
  const { resolve: destructured } = import.meta;
  expect(destructured).toBe(resolve);
  expect(import.meta.resolve.bind(null)('./importMetaResolve.test.ts')).toBe(
    import.meta.url,
  );
});

it('resolves literals and variables relative to the test source', () => {
  expect(import.meta.resolve('./importMetaResolve.test.ts')).toBe(
    import.meta.url,
  );
  const specifier = './missing file#%.json';
  expect(import.meta.resolve(specifier)).toBe(
    new URL(specifier, import.meta.url).href,
  );
  expect(import.meta['resolve']('./importMetaResolve.test.ts')).toBe(
    import.meta.url,
  );
  expect(import.meta.resolve?.('./importMetaResolve.test.ts')).toBe(
    import.meta.url,
  );
});

it('binds imported source resolvers to their own source modules', () => {
  const expected = new URL(
    './require-resolve-origin/exportHelper.js',
    import.meta.url,
  ).href;
  expect(resolveImportMeta('./exportHelper.js')).toBe(expected);
  const resolve = getImportMetaResolve();
  expect(resolve).toBe(getImportMetaResolve());
  expect(resolve).not.toBe(import.meta.resolve);
  expect(resolve('./exportHelper.js')).toBe(expected);
});

it('preserves Node ESM resolution and errors', () => {
  expect(import.meta.resolve('fs')).toBe('node:fs');
  expect(import.meta.resolve('node:fs')).toBe('node:fs');
  expect(import.meta.resolve('data:text/javascript,export default 1')).toBe(
    'data:text/javascript,export default 1',
  );
  expect(import.meta.resolve('#rstest-resolve')).toBe(
    new URL('./require-resolve-origin/index.js', import.meta.url).href,
  );
  expect(() => import.meta.resolve('rstest-missing-resolve-package')).toThrow(
    /Cannot find package/,
  );
});

it('preserves an explicit parent URL', () => {
  const parent = new URL('./require-resolve-origin/index.js', import.meta.url)
    .href;
  expect(import.meta.resolve('./exportHelper.js', parent)).toBe(
    new URL('./require-resolve-origin/exportHelper.js', import.meta.url).href,
  );
  expect(
    import.meta.resolve('./asset.json', 'https://example.com/source.js'),
  ).toBe('https://example.com/asset.json');
});
