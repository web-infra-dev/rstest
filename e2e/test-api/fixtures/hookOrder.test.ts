import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from '@rstest/core';

const events: string[] = [];
const list = process.env.HOOK_ORDER === 'list';

beforeEach(() => {
  events.push('root:beforeEach');
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
      events.push('outer:cleanupAll');
    };
  });
  beforeAll(() => {
    events.push('outer:beforeAll:2');
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
      events.push('outer:cleanupEach');
    };
  });
  beforeEach(() => {
    events.push('outer:beforeEach:2');
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
    });
    afterAll(() => {
      events.push('inner:afterAll:1');
    });
    afterAll(() => {
      events.push('inner:afterAll:2');
    });
    beforeEach(() => {
      events.push('inner:beforeEach');
    });
    afterEach(() => {
      events.push('inner:afterEach:1');
    });
    afterEach(() => {
      events.push('inner:afterEach:2');
    });
    test.each([1, 2])('test %i', () => {
      events.push('test');
    });
  });

  test('sibling', () => {
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
    'outer:cleanupEach',
  ];
  const innerTest = [
    ...beforeEach,
    'inner:beforeEach',
    'test',
    ...order.map((n) => `inner:afterEach:${n}`),
    ...afterEach,
  ];
  expect(events).toEqual([
    'outer:beforeAll:1',
    'outer:beforeAll:2',
    'inner:beforeAll',
    ...innerTest,
    ...innerTest,
    ...order.map((n) => `inner:afterAll:${n}`),
    ...beforeEach,
    'sibling',
    ...afterEach,
    ...order.map((n) => `outer:afterAll:${n}`),
    'outer:cleanupAll',
  ]);
  console.log(`HOOK_ORDER_OK:${list ? 'list' : 'stack'}`);
});
