import { expect, test } from '@rstest/core';
import { act, renderHook } from '@testing-library/react';
import { useCounter } from '../src/useCounter';

test('should initialize with default value', () => {
  const { result } = renderHook(() => useCounter());

  expect(result.current.count).toBe(0);
});

test('should initialize with custom value', () => {
  const { result } = renderHook(() => useCounter(10));

  expect(result.current.count).toBe(10);
});

test('should increment counter', () => {
  const { result } = renderHook(() => useCounter(0));

  act(() => {
    result.current.increment();
  });

  expect(result.current.count).toBe(1);
});

test('should decrement counter', () => {
  const { result } = renderHook(() => useCounter(5));

  act(() => {
    result.current.decrement();
  });

  expect(result.current.count).toBe(4);
});

test('should reset counter', () => {
  const { result } = renderHook(() => useCounter(5));

  act(() => {
    result.current.increment();
    result.current.increment();
  });

  expect(result.current.count).toBe(7);

  act(() => {
    result.current.reset();
  });

  expect(result.current.count).toBe(5);
});
