import { afterAll } from '@rstest/core';

process.env.RETEST_SETUP_FLAG = '1';

afterAll(() => {
  console.log('[afterAll] setup');
});
