/**
 * Basic React component testing example.
 *
 * Demonstrates:
 * - Rendering components with `render` from @rstest/browser-react
 * - Querying DOM elements with @testing-library/dom
 * - Simulating user interactions with @testing-library/user-event
 */
import { render } from '@rstest/browser-react';
import { describe, expect, test } from '@rstest/core';
import { getByRole, getByTestId } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { Counter } from '../src/Counter';

describe('Counter', () => {
  test('renders with initial count', async () => {
    const { container } = await render(<Counter />);

    expect(getByTestId(container, 'count').textContent).toBe('0');
  });

  test('increments count on button click', async () => {
    const { container } = await render(<Counter />);

    const button = getByRole(container, 'button', { name: 'Increment' });
    await userEvent.click(button);

    expect(getByTestId(container, 'count').textContent).toBe('1');
  });

  test('decrements count on button click', async () => {
    const { container } = await render(<Counter initialCount={5} />);

    const button = getByRole(container, 'button', { name: 'Decrement' });
    await userEvent.click(button);

    expect(getByTestId(container, 'count').textContent).toBe('4');
  });
});
