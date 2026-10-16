import { it } from '@rstest/core';

it('pkg-b include must skip this file', () => {
  throw new Error('pkg-b include was not applied');
});
