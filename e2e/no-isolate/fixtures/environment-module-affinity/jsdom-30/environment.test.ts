import { expect, test } from '@rstest/core';

test('uses the project jsdom 30 installation', () => {
  expect(navigator.userAgent).toContain('jsdom/30.1.2');
});
