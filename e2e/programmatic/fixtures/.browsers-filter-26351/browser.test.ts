import { expect, it } from '@rstest/core';

it('runs in the selected browser', () => {
  expect(window.innerWidth).toBe(900);
});
