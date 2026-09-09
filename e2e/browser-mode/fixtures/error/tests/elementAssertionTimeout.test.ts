import { page } from '@rstest/browser';
import { afterAll, beforeAll, describe, expect, test } from '@rstest/core';

test('reports the element assertion before the test timeout', async () => {
  const count = document.createElement('div');
  count.setAttribute('aria-label', 'count');
  count.textContent = '5';
  document.body.appendChild(count);

  await expect
    .element(page.getByLabel('count', { exact: true }))
    .toHaveText('6');
}, 500);

test('uses the Browser Mode poll timeout by default', async () => {
  const count = document.createElement('div');
  count.setAttribute('aria-label', 'default-count');
  count.textContent = '5';
  document.body.appendChild(count);

  await expect.element(page.getByLabel('default-count')).toHaveText('6');
}, 10000);

const fixtureCount = document.createElement('div');
fixtureCount.setAttribute('aria-label', 'fixture-count');
fixtureCount.textContent = '5';
document.body.appendChild(fixtureCount);

const fixtureTest = test.extend('fixtureValue', async () => {
  await expect.element(page.getByLabel('fixture-count')).toHaveText('6');
  return 'value';
});

fixtureTest(
  'runs fixture setup',
  ({ fixtureValue }) => {
    expect(fixtureValue).toBe('value');
  },
  2000,
);

const cleanupFixtureTest = test.extend(
  'cleanupFixtureValue',
  async (_context, { onCleanup }) => {
    onCleanup(async () => {
      const count = document.createElement('div');
      count.setAttribute('aria-label', 'fixture-cleanup-count');
      count.textContent = '5';
      document.body.appendChild(count);

      await expect
        .element(page.getByLabel('fixture-cleanup-count'))
        .toHaveText('6');
    });
    return 'value';
  },
);

cleanupFixtureTest(
  'runs fixture cleanup',
  ({ cleanupFixtureValue }) => {
    expect(cleanupFixtureValue).toBe('value');
  },
  2000,
);

describe('suite hook assertion timeout', () => {
  beforeAll(async () => {
    const count = document.createElement('div');
    count.setAttribute('aria-label', 'before-all-count');
    count.textContent = '5';
    document.body.appendChild(count);

    await expect.element(page.getByLabel('before-all-count')).toHaveText('6');
  }, 2000);

  afterAll(async () => {
    const count = document.createElement('div');
    count.setAttribute('aria-label', 'after-all-count');
    count.textContent = '5';
    document.body.appendChild(count);

    await expect.element(page.getByLabel('after-all-count')).toHaveText('6');
  }, 2000);

  test('runs suite hooks', () => {});
});

describe('suite cleanup assertion timeout', () => {
  beforeAll(
    () => async () => {
      const count = document.createElement('div');
      count.setAttribute('aria-label', 'before-all-cleanup-count');
      count.textContent = '5';
      document.body.appendChild(count);

      await expect
        .element(page.getByLabel('before-all-cleanup-count'))
        .toHaveText('6');
    },
    2000,
  );

  test('runs the suite cleanup', () => {});
});

describe.concurrent('concurrent suite with a nested suite', () => {
  describe('nested suite', () => {
    test('runs the nested test', () => {});
  });
});
