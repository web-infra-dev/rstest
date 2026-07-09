import React from 'react';
import ReactDOMServer from 'react-dom/server';
import App from './App';

export function renderToString(props?: { greeting?: string }) {
  return ReactDOMServer.renderToString(
    <React.StrictMode>
      <App {...props} />
    </React.StrictMode>,
  );
}
