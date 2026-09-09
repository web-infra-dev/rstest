import { expect, it } from '@rstest/core';

it('does not fail coverage collection for a malformed inline source map', () => {
  const value = globalThis.eval(`(() => 42)()
//# sourceURL=${location.origin}/malformed-inline-map.js
//# sourceMappingURL=data:application/json;base64,bm90IGpzb24=`);

  expect(value).toBe(42);
});
