import { test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('click error', async () => {
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  element.click();
});
