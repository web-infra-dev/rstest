import { expect, test } from '@rstest/core';

test('uses the project jsdom 26 installation', () => {
  expect(navigator.userAgent).toContain('jsdom/26.1.0');
});
