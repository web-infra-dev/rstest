import { useState } from 'react';

/**
 * A custom hook for testing renderHook
 */
export function useCounter(initialValue = 0): {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
} {
  const [count, setCount] = useState(initialValue);

  return {
    count,
    increment: () => setCount((c) => c + 1),
    decrement: () => setCount((c) => c - 1),
    reset: () => setCount(initialValue),
  };
}
