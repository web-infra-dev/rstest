import { createRequire } from 'node:module';
import type { FakeTimers } from './fakeTimers';

const workerRequire = createRequire(import.meta.url);

let cachedFakeTimersClass: typeof FakeTimers | undefined;

/**
 * Node worker build (`worker` lib aliases `./fakeTimersLoader` here): the class
 * is bundled as `worker-fake-timers.cjs` and required synchronously on first
 * use, so there is nothing to warm. This also keeps the browser's dynamic
 * chunk import out of the worker bundle.
 */
export const prepareFakeTimers = (): Promise<void> => Promise.resolve();

export const getFakeTimersClass = (): typeof FakeTimers => {
  cachedFakeTimersClass ??= (
    workerRequire('./worker-fake-timers.cjs') as Pick<
      typeof import('./fakeTimers'),
      'FakeTimers'
    >
  ).FakeTimers;
  return cachedFakeTimersClass;
};
