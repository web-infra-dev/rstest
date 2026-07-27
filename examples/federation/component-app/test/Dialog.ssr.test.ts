import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';
import Dialog from '../src/Dialog.jsx';

test('SSR: Dialog renders when visible', () => {
  const html = renderToString(
    React.createElement(Dialog, { visible: true, switchVisible: () => {} }),
  );
  expect(html).toContain('What is your name');
});
