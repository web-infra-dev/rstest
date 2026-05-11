import { renderHook } from '@rstest/browser-react/react17';
import { describe, expect, it } from '@rstest/core';
import { useCounter } from '../src/useCounter';

describe('@rstest/browser-react renderHook (React 17)', () => {
  it('should render hook with initial value', async () => {
    const { result } = await renderHook(() => useCounter(5));

    expect(result.current.count).toBe(5);
  });

  it('should handle hook state updates with act', async () => {
    const { result, act } = await renderHook(() => useCounter(0));

    expect(result.current.count).toBe(0);

    await act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(1);

    await act(() => {
      result.current.increment();
      result.current.increment();
    });

    expect(result.current.count).toBe(3);
  });

  it('should handle unmount', async () => {
    const { result, unmount } = await renderHook(() => useCounter(0));

    expect(result.current.count).toBe(0);

    await unmount();

    expect(result.current.count).toBe(0);
  });
});
