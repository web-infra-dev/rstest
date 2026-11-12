import { describe, expect, it } from '@rstest/core';
import { createConcurrencyLimiter } from '../src/concurrencyLimiter';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createConcurrencyLimiter', () => {
  it('never runs more tasks than the limit and keeps FIFO order', async () => {
    const limiter = createConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const started: number[] = [];
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        limiter.run(async () => {
          started.push(i);
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('releases the slot when a task throws', async () => {
    const limiter = createConcurrencyLimiter(1);
    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
  });

  it('treats release as idempotent', async () => {
    const limiter = createConcurrencyLimiter(1);
    const release = await limiter.acquire();
    release();
    release();
    let active = 0;
    let peak = 0;
    await Promise.all(
      [0, 1].map(() =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );
    expect(peak).toBe(1);
  });

  it('clamps a non-positive limit to one slot', async () => {
    const limiter = createConcurrencyLimiter(0);
    await expect(limiter.run(async () => 1)).resolves.toBe(1);
  });

  it('bounds files running at once across a headless pool and a headed lane sharing it', async () => {
    const limiter = createConcurrencyLimiter(1);
    let active = 0;
    let peak = 0;
    const runFile = () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await tick();
        active--;
      });
    // Three headless workers draining 6 files plus one headed lane with 3.
    const queue = Array.from({ length: 6 }, () => runFile);
    const worker = async () => {
      let next = queue.shift();
      while (next) {
        await next();
        next = queue.shift();
      }
    };
    const headed = async () => {
      for (let i = 0; i < 3; i++) {
        await runFile();
      }
    };
    await Promise.all([worker(), worker(), worker(), headed()]);
    expect(peak).toBe(1);
  });
});
