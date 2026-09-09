import { expect, it } from '@rstest/core';

it('must not run when project B globalSetup fails', () => {
  console.log('Project B test should not be printed');
  expect(true).toBe(true);
});
