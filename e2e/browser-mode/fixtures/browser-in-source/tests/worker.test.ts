import { expect, it } from '@rstest/core';

it('treats import.meta.rstest as undefined in a Web Worker', async () => {
  const worker = new Worker(
    new URL('../workers/importMetaRstest.ts', import.meta.url),
    { type: 'module' },
  );

  try {
    const value = await new Promise<string>((resolve, reject) => {
      worker.addEventListener('message', (event) => resolve(event.data), {
        once: true,
      });
      worker.addEventListener('error', (event) => reject(event.error), {
        once: true,
      });
    });
    expect(value).toBe('undefined');
  } finally {
    worker.terminate();
  }
});
