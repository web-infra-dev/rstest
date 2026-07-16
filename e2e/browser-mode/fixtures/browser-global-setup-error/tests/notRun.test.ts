import { expect, it } from '@rstest/core';

it('must not run when globalSetup fails', () => {
  console.log('This should not be printed');
  expect(true).toBe(true);
});
