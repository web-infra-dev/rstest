import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import Button from 'component-app/Button';
import Dialog from 'component-app/Dialog';
import ToolTip from 'component-app/ToolTip';

test('federated Button renders', () => {
  render(<Button type="primary" />);
  expect(
    screen.getByRole('button', { name: /primary Button/i }),
  ).toBeInTheDocument();
});

test('federated Dialog renders when visible', () => {
  render(<Dialog visible={true} switchVisible={() => {}} />);
  expect(screen.getByText(/What is your name/i)).toBeInTheDocument();
});

test('federated ToolTip renders with content/message', () => {
  render(<ToolTip content="hover me please" message="Hello,world!" />);
  const el = screen.getByText(/hover me please/i);
  expect(el).toBeInTheDocument();
  expect(el).toHaveAttribute('data-content', 'Hello,world!');
});
