// @rstest-environment jsdom
// @rstest-environment-options { "url": "https://rstest.example/alternate-comment" }
import { expect, test } from '@rstest/core';
import { assertFreshEnvironment } from './environmentCommentAssertions';

test('uses a different URL in a fresh jsdom environment', () => {
  assertFreshEnvironment();
  expect(window.location.href).toBe('https://rstest.example/alternate-comment');
});
