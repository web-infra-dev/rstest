import { expect, it } from '@rstest/core';

let attempts = 0;

it('skips after a failed retry', (context) => {
  attempts++;
  if (attempts > 1) {
    context.skip();
  }

  document.body.innerHTML = '<main>failed attempt before skip</main>';
  expect(false).toBe(true);
});
