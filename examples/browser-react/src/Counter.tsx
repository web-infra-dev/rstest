import { useState } from 'react';

interface CounterProps {
  initialCount?: number;
}

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount);

  return (
    <div>
      <span data-testid="count">{count}</span>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        Increment
      </button>
      <button type="button" onClick={() => setCount((c) => c - 1)}>
        Decrement
      </button>
    </div>
  );
}
