import fs from 'node:fs';
import { expect } from '@rstest/core';

export const getTestName = (log: string, prefix: string) =>
  log.slice(0, log.lastIndexOf('(')).split(prefix)[1]!.trim();

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
