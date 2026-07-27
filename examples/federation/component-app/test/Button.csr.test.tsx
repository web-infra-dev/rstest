import { expect, test } from '@rstest/core';
import React from 'react';
import { createRoot } from 'react-dom/client';
import Button from '../src/Button.jsx';

test('CSR: Button renders primary', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(React.createElement(Button, { type: 'primary' }));

  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(container.textContent).toContain('primary Button');

  root.unmount();
  container.remove();
});
