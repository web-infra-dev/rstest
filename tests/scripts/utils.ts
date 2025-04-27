import fs from 'node:fs';
import { expect } from '@rstest/core';

export const expectFile = (filePath: string, timeout = 3000) =>
  expect
    .poll(() => fs.existsSync(filePath), {
      timeout,
    })
    .toBeTruthy();

export const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
