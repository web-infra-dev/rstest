import { test } from '@rstest/core';

test('prints call sites', () => {
  console.table([{ id: 1 }]);
  console.trace('trace call site');
});
