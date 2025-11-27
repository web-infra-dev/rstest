import { expect, it } from '@rstest/core';

it('should test json file correctly', async () => {
  const jsonPath = './test.json';
  // will external and load json file in runtime
  const json = await import(jsonPath);
  // will bundle json file during build
  const jsonA = await import('./test.json');

  expect(json.value).toBe(123);
  expect(json).toEqual(jsonA);
});
