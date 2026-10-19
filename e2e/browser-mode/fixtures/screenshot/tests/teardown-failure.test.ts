import { afterEach, expect, it, onTestFinished } from '@rstest/core';

it('fails in afterEach', () => {
  document.body.innerHTML = '<main>before teardown</main>';
  onTestFinished(() => {
    document.body.innerHTML = '<main>later cleanup</main>';
  });
});

afterEach(() => {
  expect(true).toBe(false);
});
