import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';

test('node-local remote dynamic import returns expected value (static path)', async () => {
  const mod = await import('node-local-remote/test');
  render(<div>{String(mod.default)}</div>);
  expect(screen.getByText('module from node-local-remote')).toBeInTheDocument();
});
