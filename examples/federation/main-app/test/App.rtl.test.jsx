import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../App.jsx';

test('renders main-app with federated remotes', async () => {
  render(<App />);

  expect(
    screen.getByText(
      'Open Dev Tool And Focus On Network,checkout resources details',
    ),
  ).toBeInTheDocument();

  expect(
    await screen.findByRole('button', { name: /primary Button/i }),
  ).toBeInTheDocument();

  // Both a heading ("hover me please!") and the tooltip trigger ("hover me please")
  // exist; assert on the actual tooltip trigger element to avoid ambiguity.
  expect(screen.getByText('hover me please')).toBeInTheDocument();

  expect(screen.getByText('Node-local remote:')).toBeInTheDocument();
  expect(screen.getByText('module from node-local-remote')).toBeInTheDocument();
});
