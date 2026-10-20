import { expect, it } from '@rstest/core';

it('captures the failed page state', () => {
  document.body.innerHTML = '<main>failure screenshot marker</main>';
  expect(true).toBe(false);
});
