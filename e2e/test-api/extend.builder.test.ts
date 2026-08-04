import { afterAll, afterEach, expect, test } from '@rstest/core';

const events: string[] = [];

const builderTest = test
  .extend('prefix', 'builder')
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

builderTest('first', ({ value }) => {
  expect(value).toBe('builder:first');
  events.push(`test:${value}`);
});

builderTest('second', ({ value }) => {
  expect(value).toBe('builder:second');
  events.push(`test:${value}`);
});

afterAll(() => {
  expect(events).toEqual([
    'setup:first',
    'test:builder:first',
    'afterEach:builder:first',
    'cleanup:first',
    'setup:second',
    'test:builder:second',
    'afterEach:builder:second',
    'cleanup:second',
  ]);
});
