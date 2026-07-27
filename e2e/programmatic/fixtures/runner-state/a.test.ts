import { it } from '@rstest/core';
import { counter } from './counter';

// The assertions live in the host script: this file only records what the
// runtime looked like when it ran — the shared module state, and the worker
// process that served it.
it('records the shared counter (a)', (ctx) => {
  counter.value += 1;
  ctx.task.meta = { ...ctx.task.meta, count: counter.value, pid: process.pid };
});
