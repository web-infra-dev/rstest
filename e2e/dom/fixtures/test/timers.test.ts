import { expect, test } from '@rstest/core';

test('pending timers are scoped to the DOM environment', () => {
  const timeout = setTimeout(() => {}, 60_000);
  const interval = setInterval(() => {}, 60_000);

  expect(typeof timeout.ref).toBe('function');
  expect(typeof interval.ref).toBe('function');
});

test.skipIf(process.env.RSTEST_OUTPUT_MODULE === 'false')(
  'ESM require uses the DOM environment timers',
  () => {
    for (const id of ['timers', 'node:timers']) {
      const timers: typeof import('node:timers') = require(id);
      expect(timers.setTimeout).toBe(globalThis.setTimeout);
    }
  },
);
