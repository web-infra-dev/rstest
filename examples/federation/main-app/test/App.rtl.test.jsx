import { expect, rs, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import App from '../App.jsx';

rs.mock('component-app/Button', () => {
  return function Button() {
    return (
      <button type="button" data-testid="mock-button">
        Primary
      </button>
    );
  };
});

rs.mock('component-app/Dialog', () => {
  return function Dialog({ visible, switchVisible }) {
    return (
      <div
        data-testid="mock-dialog"
        style={{ display: visible ? 'block' : 'none' }}
      >
        <button type="button" onClick={() => switchVisible(false)}>
          Close
        </button>
      </div>
    );
  };
});

rs.mock('component-app/ToolTip', () => {
  return function ToolTip({ content, message }) {
    return (
      <span data-testid="mock-tooltip">
        {content}: {message}
      </span>
    );
  };
});

rs.mock('node-local-remote/test', () => ({
  default: 'module from node-local-remote (mock)',
}));

test('renders main-app with mocked federated remotes', async () => {
  render(<App />);

  expect(
    screen.getByText(
      'Open Dev Tool And Focus On Network,checkout resources details',
    ),
  ).toBeInTheDocument();

  expect(screen.getByTestId('mock-button')).toBeInTheDocument();

  expect(screen.getByTestId('mock-tooltip')).toHaveTextContent(
    'hover me please: Hello,world!',
  );

  expect(screen.getByText('Node-local remote:')).toBeInTheDocument();
  expect(
    screen.getByText('module from node-local-remote (mock)'),
  ).toBeInTheDocument();
});
