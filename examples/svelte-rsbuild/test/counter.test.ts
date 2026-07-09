import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mount, tick, unmount } from 'svelte';
import Counter from '../src/components/Counter.svelte';

describe('pluginSvelte - component rendering', () => {
  let container: HTMLDivElement;
  let instance: ReturnType<typeof mount> | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (instance) {
      await unmount(instance);
      instance = undefined;
    }

    container.remove();
  });

  it('should render with initial value', async () => {
    instance = mount(Counter, {
      target: container,
      props: {
        initialValue: 10,
      },
    });

    await tick();

    expect(
      container.querySelector('[data-testid="counter-value"]')?.textContent,
    ).toBe('10');
  });

  it('should increment on button click', async () => {
    instance = mount(Counter, {
      target: container,
    });

    await tick();

    const incrementButton = container.querySelector(
      '[data-testid="increment-btn"]',
    ) as HTMLButtonElement;
    incrementButton.click();

    await tick();

    expect(
      container.querySelector('[data-testid="counter-value"]')?.textContent,
    ).toBe('1');
  });
});
