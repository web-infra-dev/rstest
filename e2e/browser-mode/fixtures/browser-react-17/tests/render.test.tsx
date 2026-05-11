import { render } from '@rstest/browser-react/react17';
import { describe, expect, it } from '@rstest/core';
import { App, Button, Counter } from '../src/App';

describe('@rstest/browser-react render (React 17)', () => {
  it('should render App component correctly', async () => {
    const { container } = await render(<App />);

    expect(container.querySelector('h1')?.textContent).toBe(
      'React Browser Test',
    );
  });

  it('should render Button with children', async () => {
    const { container } = await render(<Button>Click me</Button>);

    const button = container.querySelector('button');
    expect(button).toBeTruthy();
    expect(button?.textContent).toBe('Click me');
    expect(button?.className).toBe('btn');
  });

  it('should render Counter with initial value', async () => {
    const { container } = await render(<Counter initialCount={5} />);

    const countDisplay = container.querySelector('[data-testid="count"]');
    expect(countDisplay?.textContent).toBe('5');
  });

  it('should handle unmount correctly', async () => {
    const { container, unmount } = await render(<App />);

    expect(container.querySelector('h1')).toBeTruthy();

    await unmount();

    expect(container.innerHTML).toBe('');
  });

  it('should handle rerender correctly', async () => {
    const { container, rerender } = await render(
      <Counter initialCount={0} title="First" />,
    );

    expect(
      container.querySelector('[data-testid="counter-title"]')?.textContent,
    ).toBe('First');

    await rerender(<Counter initialCount={10} title="Second" />);

    expect(
      container.querySelector('[data-testid="counter-title"]')?.textContent,
    ).toBe('Second');
  });
});
