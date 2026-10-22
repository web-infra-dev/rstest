import { it } from '@rstest/core';

it('pkg-a include must skip this file', () => {
  throw new Error('pkg-a include was not applied');
});
