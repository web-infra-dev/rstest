import { cleanup, render } from '@rstest/browser-react/pure';
import { describe, expect, it } from '@rstest/core';
import { Counter } from '../src/App';

describe('@rstest/browser-react cleanup', () => {
  it('should cleanup all mounted components', async () => {
    // Render multiple components
    await render(<Counter initialCount={1} />);
    await render(<Counter initialCount={2} />);
    await render(<Counter initialCount={3} />);

    // All should be in the DOM
    const counters = document.querySelectorAll('.counter');
    expect(counters.length).toBe(3);

    // Cleanup all
    await cleanup();

    // All should be removed
    const countersAfter = document.querySelectorAll('.counter');
    expect(countersAfter.length).toBe(0);
  });

  it('should allow rendering after cleanup', async () => {
    const { container } = await render(<Counter initialCount={10} />);
    expect(container.querySelector('[data-testid="count"]')?.textContent).toBe(
      '10',
    );

    await cleanup();

    // Should be able to render again
    const { container: container2 } = await render(
      <Counter initialCount={20} />,
    );
    expect(container2.querySelector('[data-testid="count"]')?.textContent).toBe(
      '20',
    );

    await cleanup();
  });
});
