import { expect, test } from '@rstest/core';

test('uses the project jsdom 29 installation', () => {
  expect(navigator.userAgent).toContain('jsdom/29.1.1');
});
