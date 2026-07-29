import { expect, it } from '@rstest/core';

it('must not run when project A globalSetup fails', () => {
  console.log('Project A test should not be printed');
  expect(true).toBe(true);
});
