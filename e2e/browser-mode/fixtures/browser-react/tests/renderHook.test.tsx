import { renderHook } from '@rstest/browser-react';
import { describe, expect, it } from '@rstest/core';
import { useCounter } from '../src/useCounter';

describe('@rstest/browser-react renderHook', () => {
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

  it('should handle rerender with new props', async () => {
    const { result, rerender } = await renderHook(
      (props?: { initial: number }) => useCounter(props?.initial ?? 0),
      { initialProps: { initial: 10 } },
    );

    expect(result.current.count).toBe(10);

    // Rerender with new initial value
    // Note: useState only uses initial value on first render
    await rerender({ initial: 20 });

    // Count should still be 10 since useState doesn't reinitialize
    expect(result.current.count).toBe(10);
  });

  it('should handle unmount', async () => {
    const { result, unmount } = await renderHook(() => useCounter(0));

    expect(result.current.count).toBe(0);

    await unmount();

    // After unmount, we can still access the last value
    expect(result.current.count).toBe(0);
  });

  it('should support wrapper option', async () => {
    let contextValue = 'default';

    const Wrapper = ({ children }: { children: React.ReactNode }) => {
      contextValue = 'wrapped';
      return <>{children}</>;
    };

    await renderHook(() => useCounter(0), { wrapper: Wrapper });

    expect(contextValue).toBe('wrapped');
  });
});
