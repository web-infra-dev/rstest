import { afterAll, afterEach, beforeEach, expect, test } from '@rstest/core';

type HookFixtures = {
  autoValue: undefined;
  baseValue: string;
  beforeValue: string;
  afterValue: string;
  cleanupValue: string;
};

const events: string[] = [];

const hookTest = test.extend<HookFixtures>({
  autoValue: [
    async (_, use) => {
      events.push('setup:auto');
      await use(undefined);
      events.push('teardown:auto');
    },
    { auto: true },
  ],
  baseValue: async (_, use) => {
    events.push('setup:base');
    await use('base');
    events.push('teardown:base');
  },
  beforeValue: async ({ baseValue }, use) => {
    events.push('setup:before');
    await use(`before:${baseValue}`);
    events.push('teardown:before');
  },
  afterValue: async (_, use) => {
    events.push('setup:after');
    await use('after');
    events.push('teardown:after');
  },
  cleanupValue: async (_, use) => {
    events.push('setup:cleanup');
    await use('cleanup');
    events.push('teardown:cleanup');
  },
});

beforeEach<HookFixtures>((context) => {
  // A compiler's output can preserve this comment before destructuring.
  const { task } = context;
  const { beforeValue } = context;
  expect(task.name).toBe('resolves fixtures used only by hooks');
  events.push(`beforeEach:${beforeValue}`);

  return (cleanupContext) => {
    const { task } = cleanupContext;
    const { cleanupValue } = cleanupContext;
    expect(task.name).toBe('resolves fixtures used only by hooks');
    events.push(`cleanup:${cleanupValue}`);
  };
});

afterEach<HookFixtures>(({ afterValue }) => {
  events.push(`afterEach:${afterValue}`);
});

hookTest('resolves fixtures used only by hooks', () => {
  events.push('test');
});

afterAll(() => {
  expect(events).toEqual([
    'setup:auto',
    'setup:base',
    'setup:before',
    'beforeEach:before:base',
    'test',
    'setup:after',
    'afterEach:after',
    'setup:cleanup',
    'cleanup:cleanup',
    'teardown:cleanup',
    'teardown:after',
    'teardown:before',
    'teardown:base',
    'teardown:auto',
  ]);
});
