import { expect, test } from '@rstest/core';

test('uses the happy-dom 20 installation', () => {
  expect(navigator.userAgent).toContain('HappyDOM/20.14.6');
});
