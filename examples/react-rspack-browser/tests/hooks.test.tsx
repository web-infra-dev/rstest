/**
 * Custom hook testing example.
 *
 * Demonstrates:
 * - Testing hooks with `renderHook` from @rstest/browser-react
 * - Using `act` to wrap state updates
 */
import { act, renderHook } from '@rstest/browser-react';
import { describe, expect, test } from '@rstest/core';
import { useToggle } from '../src/useToggle';

describe('useToggle', () => {
  test('starts with initial value', async () => {
    const { result } = await renderHook(() => useToggle(true));

    expect(result.current.value).toBe(true);
  });

  test('toggles the value', async () => {
    const { result } = await renderHook(() => useToggle());

    expect(result.current.value).toBe(false);

    await act(() => result.current.toggle());

    expect(result.current.value).toBe(true);
  });

  test('setTrue and setFalse work correctly', async () => {
    const { result } = await renderHook(() => useToggle());

    await act(() => result.current.setTrue());
    expect(result.current.value).toBe(true);

    await act(() => result.current.setFalse());
    expect(result.current.value).toBe(false);
  });
});
