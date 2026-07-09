import React from 'react';
import ReactDOM from 'react-dom/client';
import { Counter } from './Counter';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Counter />
  </React.StrictMode>,
);
