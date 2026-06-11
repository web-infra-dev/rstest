import { test } from '@rstest/core';

// A captured `console` reference, like a logger that grabs `console` once.
const log = globalThis.console;

test('schedules console calls that outlive the test file', () => {
  // None of these are awaited, so they fire after this file's tests finish. With
  // `isolate: false` the host disposes this file's birpc channel as soon as the
  // file finishes, but the worker only closes it once the next file starts.
  // Spread the logs across that handoff window so some fire while the channel is
  // disposed-but-open and the later one fires after the worker has closed it.
  // The forward rejects in both cases; neither may crash the run.
  for (let delay = 0; delay <= 60; delay += 5) {
    setTimeout(() => log.log('late log from a.test.ts'), delay);
  }
  setTimeout(() => log.log('late log from a.test.ts'), 250);
});
