import { it } from '@rstest/core';
import { counter } from './counter';

it('records the shared counter (b)', (ctx) => {
  counter.value += 1;
  ctx.task.meta = { ...ctx.task.meta, count: counter.value, pid: process.pid };
});
