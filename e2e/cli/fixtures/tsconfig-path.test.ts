import { expect, test } from '@rstest/core';
// @ts-expect-error - resolved by --source.tsconfigPath in the e2e test
import { aliasValue } from '@cli-options/value';

test('resolves alias from CLI source.tsconfigPath', () => {
  expect(aliasValue).toBe('source.tsconfigPath CLI option');
});
