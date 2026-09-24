import { mergeRstestConfig, test } from '@rstest/core';

export const sayHi = () => 'hi';

export const sourceTest = test;
export const mergeSourceConfig = () =>
  mergeRstestConfig({ retry: 3 }, { retry: 7 });
