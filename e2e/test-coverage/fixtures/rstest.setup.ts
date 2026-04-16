import { beforeAll } from '@rstest/core';

beforeAll(() => {
  process.env.rstest_1 = '1';
});
