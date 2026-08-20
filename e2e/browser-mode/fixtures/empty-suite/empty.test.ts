import { afterAll, beforeAll, describe } from '@rstest/core';

beforeAll(() => {
  throw new Error('EMPTY_SUITE_HOOK_RAN:beforeAll');
});

afterAll(() => {
  throw new Error('EMPTY_SUITE_HOOK_RAN:afterAll');
});

describe('empty suite', () => {});
