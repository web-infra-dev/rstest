import { expect, it } from '@rstest/core';

const {
  default: aliasValue,
}: { default: string } = require('@modified-void-alias');

it('applies in-place modifyRspackConfig mutations returning void', () => {
  expect(aliasValue).toBe('resolved by Rspack fallback');
});
