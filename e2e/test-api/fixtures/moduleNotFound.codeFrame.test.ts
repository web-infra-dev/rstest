import { it } from '@rstest/core';

const unexpectNotFound = async () => {
  // @ts-expect-error
  return import('aaa');
};

it('test expectNotFound error', async () => {
  await unexpectNotFound();
});
