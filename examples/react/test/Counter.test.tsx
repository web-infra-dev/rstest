import { expect, test } from '@rstest/core';
import { fireEvent, render, screen } from '@testing-library/react';
import Counter from '../src/Counter';

test('should render Counter with initial count of 0', () => {
  render(<Counter />);

  expect(screen.getByTestId('count')).toHaveTextContent('Count: 0');
});

test('should render Counter with custom initial count', () => {
  render(<Counter initialCount={5} />);

  expect(screen.getByTestId('count')).toHaveTextContent('Count: 5');
});

test('should increment counter on button click', () => {
  render(<Counter />);

  const button = screen.getByRole('button', { name: /increment/i });
  expect(screen.getByTestId('count')).toHaveTextContent('Count: 0');

  fireEvent.click(button);
  expect(screen.getByTestId('count')).toHaveTextContent('Count: 1');

  fireEvent.click(button);
  expect(screen.getByTestId('count')).toHaveTextContent('Count: 2');
});
