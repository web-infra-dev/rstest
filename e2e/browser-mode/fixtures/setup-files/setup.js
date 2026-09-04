import { beforeEach } from '@rstest/core';

globalThis.__SETUP_EXECUTED__ = true;
globalThis.__SETUP_TIMESTAMP__ = Date.now();
globalThis.__SETUP_BEFORE_EACH_COUNT__ = 0;
globalThis.__customHelper__ = (value) => value.toUpperCase();

beforeEach(() => {
  globalThis.__SETUP_BEFORE_EACH_COUNT__ += 1;
  console.log(
    `RSTEST_SETUP_BEFORE_EACH_${globalThis.__SETUP_BEFORE_EACH_COUNT__}`,
  );
});
