import { beforeAll, beforeEach, describe } from '@rstest/core';

beforeAll(() => {
  console.log('[beforeAll] should not run');
});

beforeEach(() => {
  console.log('[beforeEach] should not run');
});

describe.skip('should skip');
describe.todo('should skip - 1');
