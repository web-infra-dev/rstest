import { page } from '@rstest/browser';
import { beforeAll, describe, expect, test } from '@rstest/core';

let notifyHookStarted: (() => void) | undefined;
const hookStarted = new Promise<void>((resolve) => {
  notifyHookStarted = resolve;
});

describe.concurrent('concurrent assertion suite', () => {
  test('does not inherit a sibling suite hook deadline', async () => {
    await hookStarted;

    const count = document.createElement('div');
    count.setAttribute('aria-label', 'concurrent-context-count');
    count.textContent = '5';
    document.body.appendChild(count);
    setTimeout(() => {
      count.textContent = '6';
    }, 800);

    await expect
      .element(page.getByLabel('concurrent-context-count'))
      .toHaveText('6');
  }, 3000);
});

describe.concurrent('concurrent hook suite', () => {
  beforeAll(async () => {
    notifyHookStarted?.();
    await new Promise((resolve) => setTimeout(resolve, 400));
  }, 500);

  test('keeps the hook active while the sibling assertion starts', () => {});
});
