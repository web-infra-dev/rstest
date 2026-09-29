import { expect, it, rs } from '@rstest/core';
import * as actual from '../src/topLevelAwait' with { rstest: 'importActual' };

rs.mock('../src/topLevelAwait', () => ({
  ...actual,
  extra: true,
}));

it('throws when requireActual targets a module with top-level await', () => {
  expect(() => rs.requireActual('../src/topLevelAwait')).toThrow(
    /rs\.requireActual\(\).*dependency graph uses top-level await/,
  );
});

it('throws when requireActual targets a module with a top-level await dependency', () => {
  expect(() => rs.requireActual('../src/topLevelAwaitReexport')).toThrow(
    /rs\.requireActual\(\).*dependency graph uses top-level await/,
  );
});

it('resolves a module with top-level await through importActual', async () => {
  const actual = await rs.importActual<typeof import('../src/topLevelAwait')>(
    '../src/topLevelAwait',
  );

  expect(actual.answer()).toBe(42);
});

it('waits for the actual module before importing its mock', async () => {
  const mocked = await import('../src/topLevelAwait');

  expect(mocked.answer()).toBe(42);
  expect(mocked.extra).toBe(true);
});

it('returns a promise exported by a synchronous module from requireActual', () => {
  const actual = rs.requireActual<Promise<string>>('../src/promiseExport.cjs');

  expect(actual).toBeInstanceOf(Promise);
});
