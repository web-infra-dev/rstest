import { describe, expect as rstestExpect, it } from '@rstest/core';
import type { Locator, Page } from 'playwright';
import { expect } from '../src';

const createLocator = ({
  count = 1,
  css = '',
  texts,
}: {
  count?: number;
  css?: string;
  texts: string[];
}) =>
  ({
    count: async () => count,
    evaluate: async (
      callback: (element: Element, arg?: string) => unknown,
      arg?: string,
    ) => {
      const element = {
        children: [],
        getBoundingClientRect: () => ({
          bottom: 10,
          height: 10,
          left: 0,
          right: 10,
          top: 0,
          width: 10,
        }),
        getComputedStyle: () => ({ getPropertyValue: () => css }),
        id: 'app',
        ownerDocument: {},
        textContent: texts.join(''),
        value: 'Hello',
      } as unknown as Element;
      Object.defineProperty(element, 'id', {
        configurable: true,
        value: 'app',
      });
      globalThis.getComputedStyle = () =>
        ({ getPropertyValue: () => css }) as unknown as CSSStyleDeclaration;
      globalThis.innerHeight = 100;
      globalThis.innerWidth = 100;
      return callback(element, arg);
    },
    evaluateAll: async () => texts,
    getAttribute: async (name: string) =>
      name === 'class' ? 'card title' : name === 'id' ? 'app' : null,
    inputValue: async () => 'Hello',
    isChecked: async () => true,
    isDisabled: async () => false,
    isEditable: async () => true,
    isEnabled: async () => true,
    isHidden: async () => false,
    isVisible: async () => true,
    textContent: async () => texts.join(''),
  }) as unknown as Locator;

const createPage = (title: string) =>
  ({
    goto: async () => null,
    locator: () => createLocator({ texts: [] }),
    title: async () => title,
    url: () => 'https://example.com/dashboard',
  }) as unknown as Page;

describe('@rstest/playwright expect', () => {
  it('supports locator text assertions', async () => {
    const locator = createLocator({ texts: ['  Hello\n', ' Rstest  '] });

    await expect(locator).toContainText('Rstest');
    await expect(createLocator({ texts: ['  Hello\n Rstest  '] })).toHaveText(
      'Hello Rstest',
    );
    await expect(createLocator({ texts: ['Hello Rstest'] })).not.toHaveText(
      'Hello',
    );
  });

  it('preserves locator strictness for single text assertions', async () => {
    const locator = createLocator({ count: 2, texts: ['Save', 'Cancel'] });

    await rstestExpect(
      expect(locator).toHaveText('SaveCancel', { timeout: 1 }),
    ).rejects.toThrow('Expected locator to resolve to 1 element');
  });

  it('supports locator list, count, and css assertions', async () => {
    const locator = createLocator({
      count: 2,
      css: 'block',
      texts: ['Hello', 'Rstest'],
    });

    await expect(locator).toHaveText(['Hello', /Rstest/]);
    await expect(locator).toHaveCount(2);
    await expect(locator).toHaveCSS('display', 'block');
    await expect(locator).toBeAttached();
  });

  it('supports element state and attribute assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toBeVisible();
    await expect(locator).not.toBeHidden();
    await expect(locator).toBeEnabled();
    await expect(locator).not.toBeDisabled();
    await expect(locator).toBeChecked();
    await expect(locator).not.toBeUnchecked();
    await expect(locator).toBeEditable();
    await expect(locator).not.toBeEmpty();
  });

  it('supports viewport assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toBeInViewport();
  });

  it('supports attached assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toBeAttached();
  });

  it('supports attribute value assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveAttribute('id', 'app');
  });

  it('supports class assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveClass(/card/);
  });

  it('supports id assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveId('app');
  });

  it('supports value assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveValue('Hello');
  });

  it('supports attribute presence assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveAttribute('id');
  });

  it('supports JS property assertions', async () => {
    const locator = createLocator({ texts: ['Hello'] });

    await expect(locator).toHaveJSProperty('id', 'app');
  });

  it('supports page title assertions', async () => {
    const page = createPage('Example Domain');

    await expect(page).toHaveTitle(/Example/);
    await expect(page).toHaveURL(/dashboard/);
    await expect(page).not.toHaveTitle('Other');
  });

  it('counts custom Playwright assertions once', async () => {
    const page = createPage('Example Domain');

    expect.assertions(1);
    await expect(page).toHaveTitle(/Example/);
  });

  it('does not overcount retried Playwright assertions', async () => {
    const locator = createLocator({ count: 0, texts: ['Hello'] });

    expect.assertions(2);
    try {
      await expect(locator).toBeAttached({ timeout: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  test.fails('records soft custom assertion failures', async () => {
    const page = createPage('Example Domain');

    await expect.soft(page).toHaveTitle('Other', { timeout: 1 });
  });

  it('keeps regular Rstest assertions available', () => {
    const locator = createLocator({ texts: ['Hello'] });

    expect(locator).toBeTruthy();
    expect.soft(locator).toBeTruthy();
  });

  it('reports custom assertion failures', async () => {
    const locator = createLocator({ count: 0, texts: ['Hello'] });

    await rstestExpect(
      expect(locator, 'custom message').toBeAttached({ timeout: 1 }),
    ).rejects.toThrow('custom message');
  });
});
