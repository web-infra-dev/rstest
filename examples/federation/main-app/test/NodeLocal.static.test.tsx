import { expect, test } from '@rstest/core';
import { render, screen } from '@testing-library/react';
import nodeLocalRemote from 'node-local-remote/test';

test('node-local remote import returns expected value (top-level import)', () => {
  render(<div>{String(nodeLocalRemote)}</div>);
  expect(screen.getByText('module from node-local-remote')).toBeInTheDocument();
});
