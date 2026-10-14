import { expect, test } from '@rstest/core';

test('uses the project jsdom 30 installation', () => {
  expect(navigator.userAgent).toMatch(/jsdom\/30\./);
});
