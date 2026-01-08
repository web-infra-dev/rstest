/**
 * This test demonstrates using @rstest/browser-react with @testing-library/dom
 * for DOM queries. This is the recommended approach for users who want
 * testing-library-style queries without the full @testing-library/react dependency.
 */
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
