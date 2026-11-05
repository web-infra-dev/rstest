import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from '@rstest/core';

const events: string[] = [];
let beforeAllCalls = 0;
let beforeEachCalls = 0;
let afterEachCalls = 0;
let suiteBeforeAllCalls = 0;
let suiteAfterAllCalls = 0;

beforeAll(() => {
  beforeAllCalls++;
});
beforeEach(() => {
  beforeEachCalls++;
});
afterEach(() => {
  afterEachCalls++;
});

it('global A', () => {
  events.push('A');
});
it('global B', () => {
  events.push('B');
});
it('explicit repeats', { repeats: 2 }, () => {
  events.push('explicit');
});

describe('suite repeats', { repeats: 1 }, () => {
  beforeAll(() => {
    suiteBeforeAllCalls++;
  });
  afterAll(() => {
    suiteAfterAllCalls++;
  });
  it('inherits suite repeats', () => {
    events.push('suite');
  });
  it('disables repeats', { repeats: 0 }, () => {
    events.push('disabled');
  });
  describe('nearest suite', { repeats: 0 }, () => {
    it('inherits nearest suite repeats', () => {
      events.push('nested');
    });
  });
});

afterAll(() => {
  expect(beforeAllCalls).toBe(1);
  expect(suiteBeforeAllCalls).toBe(1);
  expect(suiteAfterAllCalls).toBe(1);
  expect(beforeEachCalls).toBe(events.length);
  expect(afterEachCalls).toBe(events.length);
  console.log(`REPEATS_EVENTS:${events.join(',')}`);
});
