import { expect, it } from '@rstest/core';

it('allocates more than the host heap limit', () => {
  // ~150MB of on-heap doubles; Buffers would live off-heap and not count.
  const chunks = Array.from({ length: 19 }, () =>
    new Array<number>(1024 * 1024).fill(1.5),
  );
  expect(chunks).toHaveLength(19);
});
