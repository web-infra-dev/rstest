import { expect, test } from '@rstest/core';

// Node >= 25 enables Web Storage by default, so `localStorage` / `sessionStorage`
// already exist on globalThis and must still be replaced by the DOM environment.
// https://github.com/web-infra-dev/rstest/issues/1583
test('should use the DOM environment web storage', () => {
  expect(localStorage).toBeInstanceOf(Storage);
  expect(sessionStorage).toBeInstanceOf(Storage);

  localStorage.setItem('k', 'v');
  expect(localStorage.getItem('k')).toBe('v');
  localStorage.removeItem('k');
  expect(localStorage.getItem('k')).toBe(null);

  sessionStorage.setItem('k', 'v');
  expect(sessionStorage.getItem('k')).toBe('v');
  sessionStorage.clear();
  expect(sessionStorage.getItem('k')).toBe(null);
});

test('should expose web storage on window', () => {
  expect(window.localStorage).toBe(localStorage);
  expect(window.sessionStorage).toBe(sessionStorage);
});
