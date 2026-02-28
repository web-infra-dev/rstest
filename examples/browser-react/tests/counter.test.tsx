/**
 * Component-library style browser testing example.
 *
 * Demonstrates:
 * - Rendering components with `render` from @rstest/browser-react
 * - Querying elements with Playwright-style Locator API (`page.getBy*`)
 * - Interacting with form controls (`click`, `selectOption`)
 * - Web-first assertions through `expect.element(locator)`
 */
import { page } from '@rstest/browser';
import { render } from '@rstest/browser-react';
import { describe, expect, test } from '@rstest/core';
import { Counter } from '../src/Counter';

describe('Counter', () => {
  test('renders product controls with default state', async () => {
    await render(<Counter />);

    await expect
      .element(page.getByRole('heading', { name: 'Soft Hoodie' }))
      .toBeVisible();
    await expect.element(page.getByLabel('count')).toHaveText('0');
    await expect
      .element(page.getByRole('button', { name: 'Decrease' }))
      .toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'Add to cart' }))
      .toBeDisabled();
  });

  test('updates quantity and allows adding to cart', async () => {
    await render(<Counter />);

    await page.getByRole('button', { name: 'Increase' }).click();
    await page.getByRole('button', { name: 'Increase' }).click();
    await page.getByLabel('Size').selectOption('L');

    await expect.element(page.getByLabel('count')).toHaveText('2');
    await expect
      .element(page.getByLabel('Selected quantity'))
      .toHaveText('Selected quantity: 2');

    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect
      .element(page.getByRole('alert'))
      .toHaveText('Added 2 item(s), size L');
  });

  test('respects max boundary and disables increase at max', async () => {
    await render(<Counter initialCount={5} />);

    await expect
      .element(page.getByRole('button', { name: 'Increase' }))
      .toBeDisabled();

    await page.getByRole('button', { name: 'Decrease' }).click();
    await expect.element(page.getByLabel('count')).toHaveText('4');

    await expect
      .element(page.getByRole('button', { name: 'Increase' }))
      .toBeEnabled();
    await page.getByRole('button', { name: 'Increase' }).click();

    await expect.element(page.getByLabel('count')).toHaveText('5');
  });
});
