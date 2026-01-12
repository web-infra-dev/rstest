import { expect, test } from '@rstest/core';

// https://github.com/capricorn86/happy-dom/pull/1612
test('should work with Uint8Array and TextEncoder in happy-dom', () => {
  expect([1]).toEqual([1]);
  expect(new TextEncoder().encode('a')).toEqual(new TextEncoder().encode('a'));
  expect(Uint8Array.from([97])).toEqual(new TextEncoder().encode('a'));
});
