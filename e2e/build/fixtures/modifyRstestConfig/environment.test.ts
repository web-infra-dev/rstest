import { expect, it } from '@rstest/core';

it('uses modified jsdom environment', () => {
  expect(document.createElement('div')).toBeInstanceOf(HTMLDivElement);
});
