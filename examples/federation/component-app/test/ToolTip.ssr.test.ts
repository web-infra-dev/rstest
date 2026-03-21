import { expect, test } from '@rstest/core';
import React from 'react';
import { renderToString } from 'react-dom/server';
import ToolTip from '../src/ToolTip.jsx';

test('SSR: ToolTip renders content/message', () => {
  const html = renderToString(
    React.createElement(ToolTip, {
      content: 'hover me please',
      message: 'Hello,world!',
    }),
  );
  expect(html).toContain('hover me please');
  expect(html).toContain('data-content="Hello,world!"');
});
