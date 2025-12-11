import { type ReactNode, useState } from 'react';

interface ButtonProps {
  onClick?: () => void;
  children: ReactNode;
}

export const Button = ({ onClick, children }: ButtonProps) => {
  return (
    <button type="button" className="btn" onClick={onClick}>
      {children}
    </button>
  );
};

interface CounterProps {
  initialCount?: number;
  title?: string;
}

export const Counter = ({ initialCount = 0, title }: CounterProps) => {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="counter">
      {title && <h2 data-testid="counter-title">{title}</h2>}
      <span data-testid="count">{count}</span>
      <Button onClick={() => setCount((c) => c + 1)}>Increment</Button>
      <Button onClick={() => setCount((c) => c - 1)}>Decrement</Button>
    </div>
  );
};

export const App = () => {
  return (
    <div className="app">
      <h1>React Browser Test</h1>
      <p data-testid="description">Testing React JSX rendering in browser</p>
      <Counter />
    </div>
  );
};
