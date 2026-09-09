import { it } from '@rstest/core';

it('should not run when modifyRstestConfig include is applied', () => {
  throw new Error('modifyRstestConfig include was not applied');
});
