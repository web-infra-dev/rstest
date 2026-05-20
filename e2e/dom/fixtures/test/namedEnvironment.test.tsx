import { expect, test } from '@rstest/core';

test('custom environment can load from a named export', () => {
  expect(window.location.href).toBe('https://named-env.example/');
  expect(
    (globalThis as { __NAMED_ENV_MARKER__?: string }).__NAMED_ENV_MARKER__,
  ).toBe('named-marker');
});
