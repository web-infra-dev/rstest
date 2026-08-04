import { afterAll, afterEach, beforeEach, expect, test } from '@rstest/core';

type HookFixtures = {
  element: HTMLDivElement;
  label: string;
};

const events: string[] = [];

const browserTest = test
  .extend<HookFixtures>({
    element: async (_, use) => {
      const element = document.createElement('div');
      element.textContent = 'fixture';
      document.body.appendChild(element);
      events.push('setup:element');
      await use(element);
      element.remove();
      events.push('teardown:element');
    },
    label: async (_, use) => {
      events.push('setup:label');
      await use('afterEach');
      events.push('teardown:label');
    },
  })
  .extend('builderValue', ({ element }, { onCleanup }) => {
    events.push('setup:builder');
    onCleanup(() => {
      expect(element.isConnected).toBe(true);
      events.push('teardown:builder');
    });
    return element.textContent;
  });

beforeEach<HookFixtures>(async ({ element }) => {
  await Promise.resolve();
  expect(element.textContent).toBe('fixture');
  events.push('beforeEach');
});

afterEach<HookFixtures>(({ label }) => {
  events.push(label);
});

browserTest(
  'resolves fixtures used only by browser hooks',
  ({ builderValue }) => {
    expect(builderValue).toBe('fixture');
    events.push('test');
  },
);

afterAll(() => {
  expect(events).toEqual([
    'setup:element',
    'setup:builder',
    'beforeEach',
    'test',
    'setup:label',
    'afterEach',
    'teardown:label',
    'teardown:builder',
    'teardown:element',
  ]);
});
