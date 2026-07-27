import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';
import Button from '../src/Button.jsx';

test('SSR: Button renders primary', () => {
  const html = renderToString(React.createElement(Button, { type: 'primary' }));
  const normalized = html.replace(/<!--.*?-->/g, '');
  expect(normalized).toContain('primary Button');
});
