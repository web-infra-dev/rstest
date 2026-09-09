import { test } from '@rstest/core';
import { runCleanupCode } from '../src/cleanup';

export const cleanupTest = test.extend(
  'cleanupValue',
  { scope: 'file' },
  (_context, { onCleanup }) => {
    onCleanup(() => runCleanupCode());
    return true;
  },
);
