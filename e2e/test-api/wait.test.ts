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

it('waitFor advances fake timers between checks', async () => {
  rs.useFakeTimers();
  try {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 500);

    await rs.waitFor(
      () => {
        if (!ready) {
          throw new Error('not ready');
        }
      },
      { timeout: 2_000, interval: 50 },
    );

    expect(ready).toBe(true);
  } finally {
    rs.useRealTimers();
  }
});

it('waitUntil advances fake timers between checks', async () => {
  rs.useFakeTimers();
  try {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 500);

    await expect(
      rs.waitUntil(() => ready, { timeout: 2_000, interval: 50 }),
    ).resolves.toBe(true);
  } finally {
    rs.useRealTimers();
  }
});

it('waitFor and waitUntil advance fake timers while an async callback waits', async () => {
  rs.useFakeTimers();
  try {
    const callback = async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return 'done';
    };
    const options = { timeout: 2_000, interval: 50 };

    await expect(rs.waitFor(callback, options)).resolves.toBe('done');
    await expect(rs.waitUntil(callback, options)).resolves.toBe('done');
  } finally {
    rs.useRealTimers();
  }
});
