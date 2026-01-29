import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

test('should render App with default greeting', () => {
  render(<App />);

  const h1 = screen.getByText('Hello World');
  expect(h1.tagName).toBe('H1');
  expect(h1).toBeInTheDocument();
});

test('should render App with custom greeting', () => {
  render(<App greeting="Custom Greeting" />);

  const h1 = screen.getByText('Custom Greeting');
  expect(h1).toBeInTheDocument();
});
