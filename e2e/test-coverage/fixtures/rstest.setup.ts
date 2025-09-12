import { beforeAll } from '@rstest/core';

beforeAll(() => {
  process.env.rstest = '1';
});
