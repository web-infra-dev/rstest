import { expect, test } from '@rstest/core';

test('custom environment can load from rstest-environment-* package fallback', () => {
  expect((globalThis as { __PACKAGE_ENV_MARKER__?: string }).__PACKAGE_ENV_MARKER__).toBe(
    'package-marker',
  );
  expect('window' in globalThis).toBe(false);
});