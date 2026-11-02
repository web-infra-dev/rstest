import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test as baseTest,
} from '@rstest/core';

const events: string[] = [];
const failure = process.env.HOOK_FAILURE;
const maxConcurrency = Number(process.env.HOOK_CONCURRENCY || 2);

if (failure === 'cycle') {
  const test = baseTest.extend<{ slow: string; x: string; y: string }>({
    slow: async (_context, use) => {
      await Promise.resolve();
      await use('slow');
    },
    x: async ({ slow, y }, use) => {
      await use(slow + y);
    },
    y: async ({ x }, use) => {
      await use(x);
    },
  });
  beforeEach<{ x: string }>(async ({ x }) => {
    events.push(x);
  });
  beforeEach<{ y: string }>(async ({ y }) => {
    events.push(y);
  });
  test('rejects cycles before waiting for shared setup', () => {
    throw new Error('Body must not run');
  });
  afterAll(() => {
    expect(events).toEqual([]);
    console.log('PARALLEL_CYCLE_REJECTED');
  });
} else if (failure) {
  describe('parallel hook failure', () => {
    const register = { beforeAll, beforeEach, afterEach, afterAll }[
      failure === 'timeout' ? 'beforeEach' : failure
    ];
    if (!register) throw new Error(`Unknown hook: ${failure}`);
    register(async () => {
      if (failure === 'timeout') {
        await new Promise(() => {});
      }
      throw new Error(`PARALLEL_FAILURE:${failure}:1`);
    });
    register(async () => {
      await Promise.resolve();
      throw new Error(`PARALLEL_FAILURE:${failure}:2`);
    });
    const finishHook = async () => {
      await Promise.resolve();
      events.push('last hook finished');
    };
    if (failure.startsWith('after')) {
      register(finishHook);
    } else {
      const before = failure === 'beforeAll' ? beforeAll : beforeEach;
      before(async () => {
        await finishHook();
        return () => {
          events.push('successful hook cleanup');
        };
      });
    }
    baseTest('body', () => {
      events.push('body');
    });
  });
  afterAll(() => {
    expect(events).toContain('last hook finished');
    expect(events.includes('body')).toBe(failure.startsWith('after'));
    if (!failure.startsWith('after')) {
      expect(events).toContain('successful hook cleanup');
    }
    console.log(`PARALLEL_FAILURE_DRAINED:${failure}`);
  });
} else {
  const completed: string[] = [];
  let active = 0;
  const makeGroup = (name: string) => {
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    let count = 0;
    return [0, 1, 2].map((index) => async () => {
      events.push(`${name}:start:${index}`);
      active++;
      expect(active).toBeLessThanOrEqual(maxConcurrency);
      if (index === Math.min(maxConcurrency, 2) - 1) release();
      await started;
      events.push(`${name}:end:${index}`);
      active--;
      if (++count === 3) completed.push(name);
    });
  };

  let fixtureSetups = 0;
  const test = baseTest.extend<{ shared: string }>({
    shared: async (_context, use) => {
      fixtureSetups++;
      await Promise.resolve();
      await use('shared');
      expect(active).toBe(0);
      completed.push('fixture cleanup');
    },
  });

  const install = (name: string) => {
    const cleanupAll = makeGroup(`${name}:cleanupAll`);
    makeGroup(`${name}:beforeAll`).forEach((fn, index) => {
      beforeAll(async () => {
        await fn();
        return cleanupAll[index];
      });
    });
    const cleanupEach = makeGroup(`${name}:cleanupEach`);
    makeGroup(`${name}:beforeEach`).forEach((fn, index) => {
      beforeEach<{ shared: string }>(async ({ shared }) => {
        expect(shared).toBe('shared');
        await fn();
        return cleanupEach[index];
      });
    });
    makeGroup(`${name}:afterEach`).forEach((fn) => afterEach(fn));
    makeGroup(`${name}:afterAll`).forEach((fn) => afterAll(fn));
  };

  describe('outer', () => {
    install('outer');
    describe('inner', () => {
      install('inner');
      test('waits for setup groups', ({ onTestFinished }) => {
        expect(completed).toEqual([
          'outer:beforeAll',
          'inner:beforeAll',
          'outer:beforeEach',
          'inner:beforeEach',
        ]);
        expect(fixtureSetups).toBe(1);
        onTestFinished(() => {
          expect(active).toBe(0);
          expect(completed.at(-1)).toBe('fixture cleanup');
          completed.push('onTestFinished');
        });
      });
    });
  });

  describe('independent hook deadlines', () => {
    for (const register of [beforeEach, afterEach]) {
      register(async ({ expect: localExpect }) => {
        const start = Date.now();
        await Promise.all([
          expect
            .poll(() => Date.now() - start, { interval: 5 })
            .toBeGreaterThan(100),
          localExpect
            .poll(() => Date.now() - start, { interval: 5 })
            .toBeGreaterThan(100),
        ]);
      }, 2000);
      register(async () => {
        await new Promise((resolve) => setTimeout(resolve, 130));
      }, 200);
    }
    baseTest('does not borrow a sibling hook deadline', () => {});
  });

  afterAll(() => {
    expect(active).toBe(0);
    expect(completed.slice(0, 6)).toEqual([
      'outer:beforeAll',
      'inner:beforeAll',
      'outer:beforeEach',
      'inner:beforeEach',
      'inner:afterEach',
      'outer:afterEach',
    ]);
    expect(completed.slice(6, 8).sort()).toEqual([
      'inner:cleanupEach',
      'outer:cleanupEach',
    ]);
    expect(completed.slice(8)).toEqual([
      'fixture cleanup',
      'onTestFinished',
      'inner:afterAll',
      'inner:cleanupAll',
      'outer:afterAll',
      'outer:cleanupAll',
    ]);
    for (const group of completed.filter((name) => name.includes(':'))) {
      const starts = events.filter((event) => event.startsWith(`${group}:`));
      expect(starts.slice(0, 2)).toEqual([
        `${group}:start:0`,
        maxConcurrency === 1 ? `${group}:end:0` : `${group}:start:1`,
      ]);
      expect(starts).toHaveLength(6);
    }
    console.log('HOOK_ORDER_OK:parallel');
  });
}
