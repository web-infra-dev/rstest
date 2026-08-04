import { afterAll, afterEach, expect, test } from '@rstest/core';

const events: string[] = [];

const namedFixtureTest = test
  .extend('prefix', 'named')
  .extend('value', async ({ prefix, task }, { onCleanup }) => {
    events.push(`setup:${task.name}`);
    onCleanup(async () => {
      await Promise.resolve();
      events.push(`cleanup:${task.name}`);
    });
    return `${prefix}:${task.name}`;
  });

afterEach<{ value: string }>(({ value }) => {
  events.push(`afterEach:${value}`);
});

namedFixtureTest('first', ({ value }) => {
  expect(value).toBe('named:first');
  events.push(`test:${value}`);
});

namedFixtureTest('second', ({ value }) => {
  expect(value).toBe('named:second');
  events.push(`test:${value}`);
});

afterAll(() => {
  expect(events).toEqual([
    'setup:first',
    'test:named:first',
    'afterEach:named:first',
    'cleanup:first',
    'setup:second',
    'test:named:second',
    'afterEach:named:second',
    'cleanup:second',
  ]);
});
