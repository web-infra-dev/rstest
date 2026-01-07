import { render } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { App, Button, Counter } from '../src/App';

describe('@rstest/browser-react render', () => {
  it('should render App component correctly', async () => {
    const { container } = await render(<App />);

    expect(container.querySelector('h1')?.textContent).toBe(
      'React Browser Test',
    );
    expect(
      container.querySelector('[data-testid="description"]')?.textContent,
    ).toBe('Testing @rstest/browser-react');
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

    // After unmount, container should be empty
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
    // Note: initialCount only affects initial state, so count won't change on rerender
  });

  it('should return correct asFragment', async () => {
    const { asFragment } = await render(<Button>Test</Button>);

    const fragment = asFragment();
    expect(fragment).toBeInstanceOf(DocumentFragment);
    expect(fragment.querySelector('button')?.textContent).toBe('Test');
  });
});

describe('@rstest/browser-react render options', () => {
  it('should support custom container', async () => {
    const customContainer = document.createElement('div');
    customContainer.id = 'custom-container';
    document.body.appendChild(customContainer);

    const { container } = await render(<App />, { container: customContainer });

    expect(container.id).toBe('custom-container');
    expect(container.querySelector('h1')).toBeTruthy();

    // Cleanup
    document.body.removeChild(customContainer);
  });

  it('should support wrapper option for providers', async () => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <div data-testid="wrapper">{children}</div>
    );

    const { baseElement } = await render(<Button>Wrapped</Button>, {
      wrapper: Wrapper,
    });

    expect(baseElement.querySelector('[data-testid="wrapper"]')).toBeTruthy();
    expect(
      baseElement.querySelector('[data-testid="wrapper"] button'),
    ).toBeTruthy();
  });
});
