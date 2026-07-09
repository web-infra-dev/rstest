import { expect, rs, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../src/App';

rs.mock('../src/module', () => ({
  h2Title: () => 'mocked',
}));

test('should render App correctly', async () => {
  render(<App />);

  const h1 = screen.getByText('Rsbuild with React');
  expect(h1.tagName).toBe('H1');
  expect(h1).toBeInTheDocument();

  const h2 = screen.getByText('mocked');
  expect(h2.tagName).toBe('H2');
  expect(h2).toBeInTheDocument();
});
