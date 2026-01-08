import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should handle click error', async () => {
  expect.assertions(1);
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  await new Promise<void>((resolve) => {
    window.addEventListener(
      'error',
      (event) => {
        expect(event.message).toBe('click error');
        event.preventDefault();
        resolve();
      },
      { once: true },
    );
    element.click();
  });

  // Ensure the assertion above is reached before the test completes.
});
