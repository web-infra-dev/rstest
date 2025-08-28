import { expect, it } from '@rstest/core';

const expectNotFound = async () => {
  try {
    // @ts-expect-error
    const res = await import('404');
    return res;
  } catch (_err) {
    return null;
  }
};

const unexpectNotFound = async () => {
  // @ts-expect-error
  return import('aaa');
};

it('test expectNotFound error', async () => {
  await expect(expectNotFound()).resolves.toBeNull();
});

it('test expectNotFound error', async () => {
  await expect(unexpectNotFound()).rejects.toThrowError(
    '[Rstest] Cannot find module "aaa"',
  );
});
