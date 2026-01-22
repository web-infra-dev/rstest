import { useState } from 'react';
import './Counter.css';

interface CounterProps {
  initialCount?: number;
}

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount);

  return (
    <div className="count">
      <span data-testid="count">{count}</span>
      <button
        type="button"
        className="count-btn"
        onClick={() => setCount((c) => c + 1)}
      >
        Increment
      </button>
      <button
        type="button"
        className="count-btn"
        onClick={() => setCount((c) => c - 1)}
      >
        Decrement
      </button>
    </div>
  );
}
