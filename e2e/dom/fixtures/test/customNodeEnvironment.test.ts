import { expect, test } from '@rstest/core';

test('custom environment can extend builtin node', () => {
  expect((globalThis as { __CUSTOM_NODE_ENV_MARKER__?: string }).__CUSTOM_NODE_ENV_MARKER__).toBe(
    'node-marker',
  );
  expect('window' in globalThis).toBe(false);
  expect(typeof process.cwd()).toBe('string');
});