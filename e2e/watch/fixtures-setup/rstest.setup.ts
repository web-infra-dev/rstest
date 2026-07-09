import { afterAll, beforeAll } from '@rstest/core';

beforeAll(() => {
  console.log('[beforeAll] setup');
});

afterAll(() => {
  console.log('[afterAll] setup');
});
