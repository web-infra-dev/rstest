import { test } from '@rstest/core';

test('grouped output', () => {
  console.group('[group] A');
  console.log('[group] inside');
  console.log('[group] line 1\n[group] line 2');
  console.groupCollapsed('[group] B');
  console.info('[group] nested 1\n[group] nested 2');
  console.groupEnd();
  console.groupEnd();
  console.log('[group] outside');
});
