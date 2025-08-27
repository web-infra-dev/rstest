import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should render App correctly', async () => {
  render(<App />);

  const element = screen.getByText('Rsbuild with React');

  expect(element.tagName).toBe('H1');
  expect(element).toBeInTheDocument();
});
