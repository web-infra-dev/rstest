import { afterAll, describe, expect, it } from '@rstest/core';

afterAll((ctx) => {
  ctx.meta.fileHook = 'afterAll';
});

describe('disk sum', { meta: { fromSuite: true, shared: 'suite' } }, () => {
  afterAll((ctx) => {
    ctx.meta.suiteHook = 'afterAll';
  });

  it('1 + 2 = 3', () => {
    expect(1 + 2).toBe(3);
  });

  it(
    'passes second case',
    { meta: { shared: 'case', caseOnly: true } },
    (ctx) => {
      ctx.task.meta = {
        ...ctx.task.meta,
        caseValue: 'second',
        replaced: true,
      };
      expect('hello').toBe('hello');
    },
  );
});
