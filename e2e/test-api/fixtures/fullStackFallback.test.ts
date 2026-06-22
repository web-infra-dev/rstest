import { it } from '@rstest/core';

it('shows first fullStack frame when user stack is empty', () => {
  const error = new Error('fallback stack marker');
  error.stack = [
    'Error: fallback stack marker',
    '    at nativeFrame (native)',
    '    at fallbackFrame (node:internal/rstest_fallback:10:5)',
    '    at hiddenFrame (node:internal/rstest_hidden:20:6)',
  ].join('\n');
  throw error;
});
