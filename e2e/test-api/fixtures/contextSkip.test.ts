import { afterEach, beforeEach, expect, it } from '@rstest/core';

const extended = it.extend({
  skipFixture: async ({ skip }, use) => {
    skip();
    await use('unreachable');
  },
});

let calls = 0;
let beforeEachCalls = 0;
let afterEachCalls = 0;

beforeEach((context) => {
  beforeEachCalls++;

  if (context.task.name === 'can skip from beforeEach') {
    context.skip();
  }
});

afterEach((context) => {
  afterEachCalls++;

  if (context.task.name === 'skips the current test body') {
    expect(context.task.result?.status).toBe('skip');
  }
});

it('skips the current test body', (context) => {
  calls++;
  context.skip();
  expect(1 + 1).toBe(3);
});

it('can skip from beforeEach', () => {
  calls++;
  expect(1 + 1).toBe(3);
});

it('continues running later tests', () => {
  calls++;
  expect(calls).toBe(2);
  expect(beforeEachCalls).toBe(3);
  expect(afterEachCalls).toBe(2);
});

extended('can skip from fixture', ({ skipFixture }) => {
  calls++;
  expect(skipFixture).toBe('unreachable');
});
