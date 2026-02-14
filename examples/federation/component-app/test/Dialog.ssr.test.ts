import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';

test('SSR: Dialog renders when visible', async () => {
  const { default: Dialog } = await import('../src/Dialog.jsx');
  const html = renderToString(
    React.createElement(Dialog, { visible: true, switchVisible: () => {} }),
  );
  expect(html).toContain('What is your name');
});
