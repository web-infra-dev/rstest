import fs from 'node:fs';

export const waitFile = async (filePath: string, timeout = 3000) => {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(interval);
        resolve(true);
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`File ${filePath} not found within ${timeout}ms`));
    }, timeout);
  });
};

export const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};
