import { expect, test as base } from '@rstest/playwright';
import type { PlaywrightOptions } from '@rstest/playwright';

const test = base.extend<{
  fixtureValue: string;
  unexpectedFixture: string;
}>({
  fixtureValue: 'fixture value',
  unexpectedFixture: async (_, use) => {
    await use('unexpected fixture value');
    throw new Error('shadowed fixture should not run');
  },
});

test('uses project Playwright config', ({ playwright }) => {
  expect(playwright.contextOptions?.viewport).toEqual({
    width: 777,
    height: 555,
  });
  console.log('RSTEST_PLAYWRIGHT_CONFIG_OK');
});

const overrideTest = base.extend({
  playwright: {
    browserName: 'chromium',
    contextOptions: {
      viewport: { width: 888, height: 666 },
    },
  } satisfies PlaywrightOptions,
});

overrideTest('keeps runtime fixture overrides working', ({ playwright }) => {
  expect(playwright.contextOptions?.viewport).toEqual({
    width: 888,
    height: 666,
  });
  console.log('RSTEST_PLAYWRIGHT_RUNTIME_EXTEND_OK');
});

test.for([{ expected: 'fixture value' }])(
  'resolves directly destructured test.for fixtures',
  ({ expected }, { fixtureValue }) => {
    expect(fixtureValue).toBe(expected);
  },
);

test.for([{ rows: [{ unexpectedFixture: 'local value' }] }])(
  'ignores fixture access through a shadowed test.for context',
  ({ rows }, context) => {
    expect(rows.map((context) => context.unexpectedFixture)).toEqual([
      'local value',
    ]);
    expect(context.task.name).toBe(
      'ignores fixture access through a shadowed test.for context',
    );
    console.log('RSTEST_PLAYWRIGHT_FOR_FIXTURES_OK');
  },
);
