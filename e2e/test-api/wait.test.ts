import { expect, it, rs } from '@rstest/core';

it('waitFor retries until callback succeeds', async () => {
  let attempts = 0;

  const result = await rs.waitFor(
    () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error(`attempt-${attempts}`);
      }
      return 'ok';
    },
    { timeout: 300, interval: 10 },
  );

  expect(result).toBe('ok');
  expect(attempts).toBe(3);
});

it('waitUntil retries until callback returns truthy', async () => {
  let attempts = 0;

  const result = await rs.waitUntil(
    () => {
      attempts += 1;
      return attempts >= 3 ? 'ready' : '';
    },
    { timeout: 300, interval: 10 },
  );

  expect(result).toBe('ready');
  expect(attempts).toBe(3);
});

it('waitFor throws the latest callback error on timeout', async () => {
  let attempts = 0;

  await expect(async () => {
    await rs.waitFor(
      () => {
        attempts += 1;
        throw new Error(`attempt-${attempts}`);
      },
      { timeout: 30, interval: 5 },
    );
  }).rejects.toThrow(/attempt-\d+/);

  expect(attempts).toBeGreaterThan(1);
});

it('waitUntil throws timeout error and accepts numeric options', async () => {
  await expect(rs.waitUntil(() => false, 20)).rejects.toThrow(
    'waitUntil timed out in 20ms',
  );
});

it('waitUntil should throw immediately when callback throws', async () => {
  let attempts = 0;

  await expect(async () => {
    await rs.waitUntil(
      () => {
        attempts += 1;
        throw new Error('stop-now');
      },
      { timeout: 1_000, interval: 50 },
    );
  }).rejects.toThrow('stop-now');

  expect(attempts).toBe(1);
});
