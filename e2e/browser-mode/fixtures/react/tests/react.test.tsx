import { describe, expect, it } from '@rstest/core';
import { App, Button, Counter } from '../src/App';
import { click, createContainer, getContainer, render } from './helper';

describe('React JSX rendering', () => {
  it('should render App component correctly', async () => {
    createContainer();
    await render(<App />);

    const container = getContainer();
    expect(container.querySelector('h1')?.textContent).toBe(
      'React Browser Test',
    );
    expect(container.querySelector('[data-testid="description"]')).toBeTruthy();
    expect(
      container.querySelector('[data-testid="description"]')?.textContent,
    ).toBe('Testing React JSX rendering in browser');
  });

  it('should render Button with children', async () => {
    createContainer();
    await render(<Button>Click me</Button>);

    const container = getContainer();
    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toBe('Click me');
    expect(button?.className).toBe('btn');
  });

  it('should render Counter with initial value', async () => {
    createContainer();
    await render(
      <Counter title="render Counter with initial value" initialCount={5} />,
    );

    const container = getContainer();
    const countDisplay = container.querySelector('[data-testid="count"]');
    expect(countDisplay?.textContent).toBe('5');
  });

  it('should handle Counter increment interaction', async () => {
    createContainer();
    await render(
      <Counter title="Counter increment interaction" initialCount={0} />,
    );

    const container = getContainer();
    const countDisplay = container.querySelector('[data-testid="count"]');
    expect(countDisplay?.textContent).toBe('0');

    const buttons = container.querySelectorAll('button');
    const incrementBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes('Increment'),
    );
    expect(incrementBtn).toBeTruthy();

    await click(incrementBtn);
    expect(countDisplay?.textContent).toBe('1');
  });

  it('should handle Counter decrement interaction', async () => {
    createContainer();
    await render(
      <Counter title="Counter decrement interaction" initialCount={10} />,
    );

    const container = getContainer();
    const countDisplay = container.querySelector('[data-testid="count"]');
    expect(countDisplay?.textContent).toBe('10');

    const buttons = container.querySelectorAll('button');
    const decrementBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes('Decrement'),
    );
    expect(decrementBtn).toBeTruthy();

    await click(decrementBtn);
    expect(countDisplay?.textContent).toBe('9');
  });

  it('should handle multiple Counter interactions', async () => {
    createContainer();
    await render(
      <Counter title="multiple Counter interactions" initialCount={0} />,
    );

    const container = getContainer();
    const countDisplay = container.querySelector('[data-testid="count"]');
    const buttons = container.querySelectorAll('button');
    const incrementBtn = Array.from(buttons).find((btn) =>
      btn.textContent?.includes('Increment'),
    );

    await click(incrementBtn);
    await click(incrementBtn);
    await click(incrementBtn);

    expect(countDisplay?.textContent).toBe('3');
  });
});
