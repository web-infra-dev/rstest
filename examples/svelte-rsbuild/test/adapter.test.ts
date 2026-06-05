import Counter from '@components/Counter.svelte';
import { afterEach, beforeEach, describe, expect, it } from '@rstest/core';
import { mount, tick, unmount } from 'svelte';

declare const __APP_VERSION__: string;

describe('withRsbuildConfig - pluginSvelte support', () => {
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

  it('should resolve @components alias from rsbuild.config.ts', async () => {
    instance = mount(Counter, {
      target: container,
      props: {
        initialValue: 5,
      },
    });

    await tick();

    expect(
      container.querySelector('[data-testid="counter-value"]')?.textContent,
    ).toBe('5');
  });

  it('should resolve @/ alias from rsbuild.config.ts', async () => {
    const { getDefaultStep } = await import('@/utils/step');

    expect(getDefaultStep()).toBe(1);
  });

  it('should inherit __APP_VERSION__ from rsbuild.config.ts', () => {
    expect(__APP_VERSION__).toBe('1.0.0');
  });
});
