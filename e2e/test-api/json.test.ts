import { expect, it } from '@rstest/core';

it('should test json file correctly', async () => {
  const jsonPath = './test.json';
  // will external and load json file in runtime
  const json = await import(jsonPath);
  // will bundle json file during build
  const jsonA = await import('./test.json');

  // Compare fields, not the namespace wrapper — runtime and bundled paths
  // produce different shells (runtime: plain `{ ...content, default }`;
  // bundled: webpack's `__esModule`/`Symbol.toStringTag` namespace).
  expect(json.value).toBe(123);
  expect(jsonA.value).toBe(123);
  expect(json.default).toEqual(jsonA.default);
});
