import { expect, it } from '@rstest/core';

it('runs in jsdom', () => {
  expect(document.body).toBeInstanceOf(HTMLBodyElement);
});
