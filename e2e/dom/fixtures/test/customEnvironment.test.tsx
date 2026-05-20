import { expect, test } from '@rstest/core';

test('custom environment can extend builtin jsdom', () => {
  expect(window.location.href).toBe('https://custom-env.example/');
  expect((globalThis as { __CUSTOM_ENV_MARKER__?: string }).__CUSTOM_ENV_MARKER__).toBe(
    'custom-marker',
  );
});