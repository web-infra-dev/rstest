import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';

test('dynamic import Button renders', async () => {
  const { default: Button } = await import('component-app/Button');
  render(<Button type="primary" />);
  expect(
    screen.getByRole('button', { name: /primary Button/i }),
  ).toBeInTheDocument();
});

test('dynamic import Dialog renders when visible', async () => {
  const { default: Dialog } = await import('component-app/Dialog');
  render(<Dialog visible={true} switchVisible={() => {}} />);
  expect(screen.getByText(/What is your name/i)).toBeInTheDocument();
});

test('dynamic import ToolTip renders with content/message', async () => {
  const { default: ToolTip } = await import('component-app/ToolTip');
  render(<ToolTip content="hover me please" message="Hello,world!" />);
  const el = screen.getByText(/hover me please/i);
  expect(el).toBeInTheDocument();
  expect(el).toHaveAttribute('data-content', 'Hello,world!');
});
