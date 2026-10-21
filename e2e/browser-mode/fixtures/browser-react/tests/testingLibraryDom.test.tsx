/**
 * This test demonstrates using @rstest/browser-react with @testing-library/dom
 * for DOM queries. This is the recommended approach for browser mode testing.
 */
import { page } from '@rstest/browser';
import { act, render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import {
  getByRole,
  getByTestId,
  getByText,
  queryByTestId,
} from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { App, Button, Counter } from '../src/App';

describe('@rstest/browser-react + @testing-library/dom', () => {
  it('uses Testing Library elements with native actions and retried assertions', async () => {
    const { container } = await render(<Counter />);
    const increment = getByRole(container, 'button', { name: 'Increment' });
    const count = getByTestId(container, 'count');
    const originalHtml = container.outerHTML;
    const button = page.elementLocator(increment);
    expect(container.outerHTML).toBe(originalHtml);

    await act(() => button.click());
    await expect.element(count).toHaveText('1');
    await expect.element(increment).toHaveRole('button');
    await expect
      .element(page.elementLocator(container).getByRole('button'))
      .toHaveCount(2);

    await act(() => page.elementLocator(increment).click());
    await expect.element(count).toHaveText('2');
    await expect
      .element(page.locator('.counter').filter({ has: button }))
      .toHaveCount(1);
  });

  it('keeps element identity when React replaces or unmounts a node', async () => {
    const { container, rerender, unmount } = await render(
      <Button key="original">Save</Button>,
    );
    const original = getByRole(container, 'button', { name: 'Save' });
    const locator = page.elementLocator(original);
    await expect.element(locator).toBeAttached();

    await rerender(<Button key="replacement">Save</Button>);
    const replacement = getByRole(container, 'button', { name: 'Save' });
    expect(replacement).not.toBe(original);
    await expect.element(locator).toBeDetached();
    await expect.element(original).toBeDetached();
    await expect.element(replacement).toBeAttached();
    await expect(locator.click({ timeout: 50 })).rejects.toThrow();

    await unmount();
    await expect.element(replacement).toBeDetached();
  });

  it('should work with getByRole query', async () => {
    const { container } = await render(<App />);

    const heading = getByRole(container, 'heading', { level: 1 });
    expect(heading.textContent).toBe('React Browser Test');
  });

  it('should work with getByTestId query', async () => {
    const { container } = await render(<App />);

    const description = getByTestId(container, 'description');
    expect(description.textContent).toBe('Testing @rstest/browser-react');
  });

  it('should work with getByText query', async () => {
    const { container } = await render(<Button>Click me</Button>);

    const button = getByText(container, 'Click me');
    expect(button.tagName).toBe('BUTTON');
    expect(button.className).toBe('btn');
  });

  it('should work with queryByTestId for non-existent elements', async () => {
    const { container } = await render(<App />);

    const nonExistent = queryByTestId(container, 'non-existent');
    expect(nonExistent).toBeNull();
  });

  it('should handle Counter interactions with userEvent', async () => {
    const user = userEvent.setup();
    const { container } = await render(<Counter initialCount={0} />);

    const countDisplay = getByTestId(container, 'count');
    expect(countDisplay.textContent).toBe('0');

    const incrementBtn = getByRole(container, 'button', { name: /increment/i });
    await act(() => user.click(incrementBtn));

    expect(countDisplay.textContent).toBe('1');
  });

  it('should handle multiple interactions', async () => {
    const user = userEvent.setup();
    const { container } = await render(<Counter initialCount={5} />);

    const countDisplay = getByTestId(container, 'count');
    const incrementBtn = getByRole(container, 'button', { name: /increment/i });
    const decrementBtn = getByRole(container, 'button', { name: /decrement/i });

    // Increment twice
    await act(() => user.click(incrementBtn));
    await act(() => user.click(incrementBtn));
    expect(countDisplay.textContent).toBe('7');

    // Decrement once
    await act(() => user.click(decrementBtn));
    expect(countDisplay.textContent).toBe('6');
  });

  it('should work with baseElement for queries', async () => {
    const { baseElement } = await render(<Counter title="Test Counter" />);

    // baseElement is document.body by default
    const title = getByTestId(baseElement, 'counter-title');
    expect(title.textContent).toBe('Test Counter');
  });
});
