import { createServer } from 'node:http';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import { promisify } from 'node:util';
import { expect, it, rstest } from '@rstest/core';

it('keeps Node timer handles while tracking real timers', async () => {
  expect(setTimeout).toBe(window.setTimeout);
  expect(setTimeout).not.toBe(nodeSetTimeout);

  const timeout = setTimeout(() => {}, 0);
  expect(typeof timeout).toBe('object');
  expect(timeout.unref).toBeTypeOf('function');
  expect(timeout.ref).toBeTypeOf('function');
  expect(timeout.refresh).toBeTypeOf('function');
  clearTimeout(timeout);

  const interval = setInterval(() => {}, 0);
  expect(typeof interval).toBe('object');
  clearInterval(interval);

  const receiver = await new Promise<NodeJS.Timeout>((resolve) => {
    setTimeout(function (this: NodeJS.Timeout) {
      resolve(this);
    }, 0);
  });
  expect(receiver.unref).toBeTypeOf('function');
});

it('preserves promisified timeout behavior', async () => {
  const sleep = promisify(setTimeout);
  await expect(sleep(1, 'done')).resolves.toBe('done');

  const addEventListener = AbortSignal.prototype.addEventListener;
  try {
    AbortSignal.prototype.addEventListener = () => {
      throw new Error('mutated addEventListener');
    };
    await expect(sleep(1, 'captured signal methods')).resolves.toBe(
      'captured signal methods',
    );
  } finally {
    AbortSignal.prototype.addEventListener = addEventListener;
  }

  const controller = new AbortController();
  const abortedSleep = sleep(60_000, undefined, {
    signal: controller.signal,
  });
  controller.abort('test abort');
  await expect(abortedSleep).rejects.toMatchObject({
    name: 'AbortError',
    code: 'ABORT_ERR',
    cause: 'test abort',
  });
});

it('cleans up pending promisified timeouts during teardown', () => {
  const sleep = promisify(setTimeout);
  void sleep(60_000).then(() => {});
});

it('keeps DOM-owned animation frame timers working', async () => {
  let frameCalled = false;
  const frame = requestAnimationFrame(() => {
    frameCalled = true;
  });
  expect(typeof frame).toBe(
    Reflect.has(window, 'happyDOM') ? 'object' : 'number',
  );
  cancelAnimationFrame(frame);
  await new Promise((resolve) => nodeSetTimeout(resolve, 20));
  expect(frameCalled).toBe(false);
});

it('routes timer callback errors through the jsdom window', async () => {
  const expected = new Error('timer error');
  const received = new Promise<unknown>((resolve) => {
    window.addEventListener(
      'error',
      (event) => {
        event.preventDefault();
        resolve(event.error);
      },
      { once: true },
    );
  });
  setTimeout(() => {
    throw expected;
  }, 0);

  expect(await received).toBe(expected);
});

it('preserves timer errors with unsafe string conversion', async () => {
  const expected = {
    toString() {
      throw new Error('unsafe timer error conversion');
    },
  };
  const received = new Promise<unknown>((resolve) => {
    window.addEventListener(
      'error',
      (event) => {
        event.preventDefault();
        resolve(event.error);
      },
      { once: true },
    );
  });
  setTimeout(() => {
    throw expected;
  }, 0);

  expect(await received).toBe(expected);
});

it('restores tracked real timers after fake timers', () => {
  const trackedSetTimeout = setTimeout;

  rstest.useFakeTimers({ now: 0 });
  let called = false;
  setTimeout(() => {
    called = true;
  }, 10);
  rstest.advanceTimersByTime(10);
  expect(called).toBe(true);

  rstest.useRealTimers();
  expect(setTimeout).toBe(trackedSetTimeout);

  const timeout = setTimeout(() => {}, 0);
  expect(typeof timeout).toBe('object');
  clearTimeout(timeout);
});

it('keeps built-in fetch compatible through the response lifecycle', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('connection', 'keep-alive');
    response.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected an IP server address');
    }

    for (let index = 0; index < 3; index++) {
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(await response.text()).toBe('ok');
    }
    await new Promise((resolve) => nodeSetTimeout(resolve, 50));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  }
});

it('cleans up pending intervals during environment teardown', () => {
  const interval = setInterval(() => {}, 60_000);
  expect(typeof interval).toBe('object');
});

it('cleans up a timeout refreshed from inside its callback', async () => {
  let calls = 0;

  await new Promise<void>((resolve) => {
    setTimeout(function (this: NodeJS.Timeout) {
      calls++;
      if (calls === 1) {
        this.refresh();
        resolve();
      } else {
        throw new Error('Refreshed timeout ran after environment teardown');
      }
    }, 100);
  });

  expect(calls).toBe(1);
});

it('cleans up the receiver of a borrowed timeout refresh', () => {
  const firstTimer = setTimeout(() => {}, 60_000);
  const secondTimer = setTimeout(() => {
    throw new Error('Borrowed refresh receiver ran after teardown');
  }, 100);

  Reflect.apply(firstTimer.refresh, secondTimer, []);
  clearTimeout(firstTimer);
});
