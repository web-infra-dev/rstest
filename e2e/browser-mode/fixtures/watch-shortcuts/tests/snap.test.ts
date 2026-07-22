import { expect, it } from '@rstest/core';

it('snapshot value', () => {
  expect('fresh').toMatchSnapshot();
});
