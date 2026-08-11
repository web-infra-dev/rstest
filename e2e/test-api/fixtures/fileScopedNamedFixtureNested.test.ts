import { describe, test } from '@rstest/core';

describe('root', () => {
  test.extend(
    'value',
    { scope: 'file' },
    () => 'value',
  )('cannot declare a file fixture inside a suite', () => {});
});
