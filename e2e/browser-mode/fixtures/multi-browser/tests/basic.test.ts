import { expect, test } from '@rstest/core';

// The two engine-independent checks of the attribution file: reused by the
// rule configs (deprecated browser field, post-filter v8, headed guards)
// whose entries do not carry the viewport overrides the third check asserts.
test('passes in every configured browser', () => {
  expect(document.createElement('main').tagName).toBe('MAIN');
});

test('reports per browser', () => {
  expect(1 + 1).toBe(2);
});
