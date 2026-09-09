import { test } from '@rstest/core';

test.extend(
  'value',
  { scope: 'file' },
  // @ts-expect-error A self-dependency is invalid by design and rejected at runtime.
  ({ value }: { value: string }) => value,
)('rejects a self-dependent file fixture', () => {});
