import { type ReactNode, useState } from 'react';

interface ButtonProps {
  onClick?: () => void;
  children: ReactNode;
}

export const Button = ({ onClick, children }: ButtonProps): JSX.Element => {
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

export const Counter = ({
  initialCount = 0,
  title,
}: CounterProps): JSX.Element => {
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

export const App = (): JSX.Element => {
  return (
    <div className="app">
      <h1>React Browser Test</h1>
      <p data-testid="description">Testing @rstest/browser-react</p>
      <Counter />
    </div>
  );
};
