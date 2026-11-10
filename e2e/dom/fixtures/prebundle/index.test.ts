import { expect, it } from '@rstest/core';

it('runs in a DOM environment', () => {
  expect(
    Object.getOwnPropertyNames(globalThis).some((key) =>
      key.startsWith('@rstest/environment/'),
    ),
  ).toBe(false);
  expect(document.body).toBeInstanceOf(HTMLBodyElement);

  const objectURL = URL.createObjectURL(new Blob(['blob']));
  expect(objectURL).toMatch(/^blob:nodedata:/);
  URL.revokeObjectURL(objectURL);
});
