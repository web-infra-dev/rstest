import { afterAll, afterEach, describe, expect, it } from '@rstest/core';

afterAll((ctx) => {
  ctx.meta = { ...ctx.meta, fileHook: 'afterAll' };
});

describe(
  'metadata suite',
  { meta: { fromSuite: true, shared: 'suite' } },
  () => {
    afterAll((ctx) => {
      ctx.meta = { ...ctx.meta, suiteHook: 'afterAll' };
    });

    it('inherits metadata', (ctx) => {
      ctx.task.meta.runtime = 'first';
      expect(1 + 1).toBe(2);
    });

    it.skip(
      'skipped metadata',
      { meta: { shared: 'skip', skippedCase: true } },
      () => {
        throw new Error('should not run');
      },
    );

    it.todo('todo metadata', {
      meta: { shared: 'todo', todoCase: true },
    });

    afterEach((ctx) => {
      if (ctx.task.name === 'overrides metadata') {
        ctx.task.meta = { ...ctx.task.meta, afterEach: true };
      }
    });

    it(
      'overrides metadata',
      { meta: { shared: 'case', caseOnly: true } },
      (ctx) => {
        ctx.task.meta = {
          ...ctx.task.meta,
          runtime: 'second',
          replaced: true,
        };
        expect('hello').toBe('hello');
      },
    );
  },
);
