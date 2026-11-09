import { expect, test } from '@rstest/core';

test('passes in every configured browser', () => {
  expect(document.createElement('main').tagName).toBe('MAIN');
});

test('reports per browser', () => {
  expect(1 + 1).toBe(2);
});
