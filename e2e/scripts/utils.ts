import fs from 'node:fs';

export const getTestName = (log: string, prefix: string) =>
  log.slice(0, log.lastIndexOf('(')).split(prefix)[1]!.trim();

export const expectFile = async (filePath: string, timeout = 3000) => {
  const { expect } = await import('@rstest/core');
  return expect
    .poll(() => fs.existsSync(filePath), {
      timeout,
    })
    .toBeTruthy();
};

export const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
