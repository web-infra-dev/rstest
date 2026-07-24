import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';

test('node-local remote import returns expected value (dynamic import)', async () => {
  const mod = await import('node-local-remote/test');
  render(<div>{String(mod.default)}</div>);
  expect(screen.getByText('module from node-local-remote')).toBeInTheDocument();
});
