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
const list = process.env.HOOK_ORDER === 'list';
const test = baseTest.extend<{ resource: string; dependent: string }>({
  resource: async (_context, use) => {
    events.push('fixture:setup:resource');
    await use('resource');
    events.push('fixture:cleanup:resource');
  },
  dependent: async ({ resource }, use) => {
    events.push('fixture:setup:dependent');
    await use(`${resource}:dependent`);
    events.push('fixture:cleanup:dependent');
  },
});

beforeEach(() => {
  events.push('root:beforeEach');
  return () => {
    events.push('root:cleanupEach');
  };
});
afterEach(() => {
  events.push('root:afterEach:1');
});
afterEach(() => {
  events.push('root:afterEach:2');
});

describe('outer', () => {
  beforeAll(() => {
    events.push('outer:beforeAll:1');
    return () => {
      events.push('outer:cleanupAll:1');
    };
  });
  beforeAll(() => {
    events.push('outer:beforeAll:2');
    return () => {
      events.push('outer:cleanupAll:2');
    };
  });
  afterAll(() => {
    events.push('outer:afterAll:1');
  });
  afterAll(() => {
    events.push('outer:afterAll:2');
  });
  beforeEach(() => {
    events.push('outer:beforeEach:1');
    return () => {
      events.push('outer:cleanupEach:1');
    };
  });
  beforeEach(() => {
    events.push('outer:beforeEach:2');
    return async () => {
      await Promise.resolve();
      events.push('outer:cleanupEach:2');
    };
  });
  afterEach(() => {
    events.push('outer:afterEach:1');
  });
  afterEach(() => {
    events.push('outer:afterEach:2');
  });

  describe('inner', () => {
    beforeAll(() => {
      events.push('inner:beforeAll');
      return async () => {
        await Promise.resolve();
        events.push('inner:cleanupAll');
      };
    });
    afterAll(() => {
      events.push('inner:afterAll:1');
    });
    afterAll(() => {
      events.push('inner:afterAll:2');
    });
    beforeEach(() => {
      events.push('inner:beforeEach');
      return () => {
        events.push('inner:cleanupEach');
      };
    });
    afterEach(() => {
      events.push('inner:afterEach:1');
    });
    afterEach(() => {
      events.push('inner:afterEach:2');
    });
    for (const index of [1, 2]) {
      test(`test ${index}`, ({ dependent }) => {
        expect(dependent).toBe('resource:dependent');
        events.push('test');
      });
    }
  });

  test('sibling', ({ dependent }) => {
    expect(dependent).toBe('resource:dependent');
    events.push('sibling');
  });
});

afterAll(() => {
  const order = list ? [1, 2] : [2, 1];
  const beforeEach = [
    'root:beforeEach',
    'outer:beforeEach:1',
    'outer:beforeEach:2',
  ];
  const afterEach = [
    ...order.map((n) => `outer:afterEach:${n}`),
    ...order.map((n) => `root:afterEach:${n}`),
  ];
  const outerCleanups = [
    'root:cleanupEach',
    'outer:cleanupEach:1',
    'outer:cleanupEach:2',
  ];
  const innerCleanups = [...outerCleanups, 'inner:cleanupEach'];
  const fixtureSetup = ['fixture:setup:resource', 'fixture:setup:dependent'];
  const fixtureCleanup = [
    'fixture:cleanup:dependent',
    'fixture:cleanup:resource',
  ];
  const innerTest = [
    ...fixtureSetup,
    ...beforeEach,
    'inner:beforeEach',
    'test',
    ...order.map((n) => `inner:afterEach:${n}`),
    ...afterEach,
    ...(list ? innerCleanups : innerCleanups.reverse()),
    ...fixtureCleanup,
  ];
  expect(events).toEqual([
    'outer:beforeAll:1',
    'outer:beforeAll:2',
    'inner:beforeAll',
    ...innerTest,
    ...innerTest,
    ...order.map((n) => `inner:afterAll:${n}`),
    'inner:cleanupAll',
    ...fixtureSetup,
    ...beforeEach,
    'sibling',
    ...afterEach,
    ...(list ? outerCleanups : outerCleanups.reverse()),
    ...fixtureCleanup,
    ...order.map((n) => `outer:afterAll:${n}`),
    ...order.map((n) => `outer:cleanupAll:${n}`),
  ]);
  console.log(`HOOK_ORDER_OK:${list ? 'list' : 'stack'}`);
});
