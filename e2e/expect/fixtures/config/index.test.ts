import { expect, test } from '@rstest/core';

test('uses the configured poll timeout', async () => {
  await expect(expect.poll(() => false).toBe(true)).rejects.toThrow(
    'Matcher did not succeed in 200ms',
  );
});

test('uses the configured poll interval', async () => {
  let attempts = 0;

  await expect.poll(() => ++attempts).toBe(6);
});

test('prefers call options over the configured defaults', async () => {
  await expect(
    expect.poll(() => false, { timeout: 50 }).toBe(true),
  ).rejects.toThrow('Matcher did not succeed in 50ms');
});
