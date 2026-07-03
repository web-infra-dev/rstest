import { fileURLToPath } from 'node:url';
import { expect, it, rs } from '@rstest/core';

// Resolved-first matching for non-literal dynamic `import(variable)`: the
// bundle keys a relative mock only by its build-resolved absolute target
// (`info.r`), and on a raw-spelling miss the worker resolves a relative
// runtime specifier against its importing module's directory. These pins
// cover the spellings that meet the absolute keys — relative
// (per-directory), absolute, and `file://` — plus the raw-key match for an
// alias spelling (aliases are matched verbatim, never expanded at runtime).

rs.mock('../fixtures/resolvedFirst/a/foo.mjs', () => ({ from: 'A_MOCKED' }));
// Declared via the alias spelling; the build resolves it to aliasDep.mjs.
rs.mock('@e2e/mock-alias-dep', () => ({ tag: 'ALIAS_MOCKED' }));

it('a relative variable import only hits the mock declared for ITS directory', async () => {
  // a/ and b/ both variable-import './foo.mjs'; only a/foo.mjs is mocked. A
  // raw request key could not tell them apart — the absolute key must.
  const a = await import('../fixtures/resolvedFirst/a/importer.mts');
  const b = await import('../fixtures/resolvedFirst/b/importer.mts');
  expect((await a.loadFoo()).from).toBe('A_MOCKED');
  expect((await b.loadFoo()).from).toBe('B_REAL');
});

it('a relative variable import from the test file resolves against the test dir', async () => {
  const spec = '../fixtures/resolvedFirst/a/foo.mjs';
  const mod = await import(spec);
  expect(mod.from).toBe('A_MOCKED');
});

it('an absolute-path variable import hits the mock', async () => {
  const abs = fileURLToPath(
    new URL('../fixtures/resolvedFirst/a/foo.mjs', import.meta.url),
  );
  const mod = await import(abs);
  expect(mod.from).toBe('A_MOCKED');
});

it('a file:// href variable import hits the mock', async () => {
  const href = new URL('../fixtures/resolvedFirst/a/foo.mjs', import.meta.url)
    .href;
  const mod = await import(href);
  expect(mod.from).toBe('A_MOCKED');
});

it('an alias variable import hits a mock declared with the same alias', async () => {
  const spec = '@e2e/mock-alias-dep';
  const mod = await import(spec);
  expect(mod.tag).toBe('ALIAS_MOCKED');
});

it('a relative variable import hits a mock declared via its ALIAS spelling', async () => {
  // Cross-spelling: declared as '@e2e/mock-alias-dep', imported relatively —
  // both resolve to the same absolute target.
  const spec = '../fixtures/resolvedFirst/aliasDep.mjs';
  const mod = await import(spec);
  expect(mod.tag).toBe('ALIAS_MOCKED');
});

it('a relative mock declared in a helper file resolves against the helper (info.o)', async () => {
  const helper =
    await import('../fixtures/resolvedFirst/helper/mockFromHelper.mts');
  expect((await helper.loadDep()).tag).toBe('MOCKED_FROM_HELPER');
});
