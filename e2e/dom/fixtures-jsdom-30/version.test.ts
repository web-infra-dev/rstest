import { expect, test } from '@rstest/core';

test('uses the jsdom 30 installation', () => {
  expect(navigator.userAgent).toContain('jsdom/30.1.3');
});
