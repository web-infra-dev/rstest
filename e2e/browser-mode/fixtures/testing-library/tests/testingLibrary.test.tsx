import { afterEach, describe, expect, it } from '@rstest/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, Button, Counter } from '../src/App';

// Cleanup after each test to avoid DOM pollution
afterEach(() => {
  cleanup();
});

describe('@testing-library/react in browser mode', () => {
  it('should render App component correctly', () => {
    render(<App />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('React Browser Test');

    const description = screen.getByTestId('description');
    expect(description.textContent).toBe(
      'Testing @testing-library/react in browser mode',
    );
  });

  it('should render Button with children', () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole('button');
    expect(button).toBeTruthy();
    expect(button.textContent).toBe('Click me');
    expect(button.className).toBe('btn');
  });

  it('should render Counter with initial value', () => {
    render(<Counter title="Test Counter" initialCount={5} />);

    expect(screen.getByTestId('count').textContent).toBe('5');
    expect(screen.getByTestId('counter-title').textContent).toBe(
      'Test Counter',
    );
  });

  it('should handle Counter increment interaction', async () => {
    const user = userEvent.setup();
    render(<Counter initialCount={0} />);

    expect(screen.getByTestId('count').textContent).toBe('0');

    const incrementBtn = screen.getByRole('button', { name: /increment/i });
    await user.click(incrementBtn);

    expect(screen.getByTestId('count').textContent).toBe('1');
  });

  it('should handle Counter decrement interaction', async () => {
    const user = userEvent.setup();
    render(<Counter initialCount={10} />);

    expect(screen.getByTestId('count').textContent).toBe('10');

    const decrementBtn = screen.getByRole('button', { name: /decrement/i });
    await user.click(decrementBtn);

    expect(screen.getByTestId('count').textContent).toBe('9');
  });

  it('should handle multiple Counter interactions', async () => {
    const user = userEvent.setup();
    render(<Counter initialCount={0} />);

    const incrementBtn = screen.getByRole('button', { name: /increment/i });

    await user.click(incrementBtn);
    await user.click(incrementBtn);
    await user.click(incrementBtn);

    expect(screen.getByTestId('count').textContent).toBe('3');
  });

  it('should support findBy queries for async elements', async () => {
    render(<App />);

    // findBy* returns a promise and waits for the element
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('React Browser Test');
  });

  it('should support queryBy queries that return null', () => {
    render(<App />);

    // queryBy* returns null if element is not found (instead of throwing)
    const nonExistent = screen.queryByTestId('non-existent');
    expect(nonExistent).toBeNull();
  });

  it('should support getAllBy queries for multiple elements', () => {
    render(<Counter />);

    // getAllBy* returns all matching elements
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2); // Increment and Decrement
  });
});
