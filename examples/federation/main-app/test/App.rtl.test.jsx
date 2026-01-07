import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';

// dynamic import to avoid eager consumption of federated remotes

test('renders main-app with federated remotes', async () => {
  const { default: App } = await import('../App.jsx');
  render(<App />);

  expect(
    screen.getByText(
      'Open Dev Tool And Focus On Network,checkout resources details',
    ),
  ).toBeInTheDocument();

  expect(
    await screen.findByRole('button', { name: /primary Button/i }),
  ).toBeInTheDocument();

  expect(screen.getByText(/hover me please/i)).toBeInTheDocument();

  expect(screen.getByText('Node-local remote:')).toBeInTheDocument();
  expect(screen.getByText('module from node-local-remote')).toBeInTheDocument();
});
