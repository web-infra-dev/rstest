// Consolidated guard for the #1376 family: one shared helper re-exporting the
// WHOLE `@rstest/core` surface by value (extended `test` + `Object.assign` +
// namespace re-exports). Evaluated once per worker; every captured API must
// still resolve the CURRENT file when used from a non-first file
// (surfaceSecond.test.ts). See https://github.com/web-infra-dev/rstest/issues/1376.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  rstest,
  test as base,
} from '@rstest/core';

export const test = Object.assign(base.extend({}), {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
});

export { expect, onTestFinished, rstest };
