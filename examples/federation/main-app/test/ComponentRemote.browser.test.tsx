import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import Button from 'component-app/Button';

test('loads and renders a federated component in Browser Mode', () => {
  render(<Button type="primary" />);

  expect(
    screen.getByRole('button', { name: /primary Button/i }),
  ).toBeInTheDocument();
});
