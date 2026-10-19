import { afterEach, expect, it } from '@rstest/core';

it('fails in afterEach', () => {
  document.body.innerHTML = '<main>before teardown</main>';
});

afterEach(() => {
  document.body.innerHTML = '';
  expect(true).toBe(false);
});
