import { expect, it } from '@rstest/core';

it('runs in jsdom', () => {
  expect(document.body).toBeInstanceOf(HTMLBodyElement);

  const objectURL = URL.createObjectURL(new Blob(['blob']));
  expect(objectURL).toMatch(/^blob:nodedata:/);
  URL.revokeObjectURL(objectURL);
});
