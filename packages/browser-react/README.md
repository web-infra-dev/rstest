# @rstest/browser-react

React component testing utilities for [Rstest](https://rstest.dev) browser mode.

This package provides `render` and `renderHook` functions for testing React components in a real browser environment. Tests run in an actual browser rather than a simulated DOM like jsdom.

For a complete working example, see the [browser example](../../examples/browser-react) in the Rstest repository.

## Installation

```bash
npm install @rstest/browser-react
# or
pnpm add @rstest/browser-react
```

For DOM queries and user interactions, also install:

```bash
npm install @testing-library/dom @testing-library/user-event
# or
pnpm install @testing-library/dom @testing-library/user-event
```

## Usage

### Basic component testing

Use the `render` function to mount a React component into the DOM. This is the foundation for all component tests:

```tsx
import { render } from '@rstest/browser-react';
import { getByRole, getByText } from '@testing-library/dom';
import { expect, test } from '@rstest/core';

test('renders button with text', async () => {
  const { container } = await render(<button>Click me</button>);

  expect(getByRole(container, 'button')).toBeTruthy();
  expect(getByText(container, 'Click me')).toBeTruthy();
});
```

### Testing with providers

When your component depends on React Context (e.g., theme, auth, store), use the `wrapper` option to wrap it with the necessary providers:

```tsx
import { render } from '@rstest/browser-react';

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme="dark">{children}</ThemeProvider>
);

test('renders with theme context', async () => {
  const { container } = await render(<MyComponent />, { wrapper: Wrapper });
  // ...assertions
});
```

### User interactions

Simulate realistic user interactions (clicks, typing, etc.) using `@testing-library/user-event`:

```tsx
import { render } from '@rstest/browser-react';
import { getByRole, getByText } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { expect, test } from '@rstest/core';

test('increments counter on click', async () => {
  const { container } = await render(<Counter />);
  const button = getByRole(container, 'button');

  await userEvent.click(button);

  expect(getByText(container, 'Count: 1')).toBeTruthy();
});
```

### Testing hooks

Use `renderHook` to test custom hooks in isolation, without needing to create a wrapper component. The returned `act` function ensures state updates are properly flushed:

```tsx
import { renderHook } from '@rstest/browser-react';
import { useState } from 'react';
import { expect, test } from '@rstest/core';

test('useState updates value', async () => {
  const { result, act } = await renderHook(() => useState(0));

  expect(result.current[0]).toBe(0);

  await act(() => {
    result.current[1](1);
  });

  expect(result.current[0]).toBe(1);
});
```

### Testing hooks with props

When your hook depends on props, use `initialProps` and `rerender` to test how the hook responds to prop changes:

```tsx
import { renderHook } from '@rstest/browser-react';
import { useMemo } from 'react';
import { expect, test } from '@rstest/core';

test('hook reacts to prop changes', async () => {
  const { result, rerender } = await renderHook(
    (props) => useMemo(() => (props?.value ?? 0) * 2, [props?.value]),
    { initialProps: { value: 5 } },
  );

  expect(result.current).toBe(10);

  await rerender({ value: 10 });

  expect(result.current).toBe(20);
});
```

### React strict mode

To enable React Strict Mode for catching potential issues, use the `configure` function:

```tsx
import { configure } from '@rstest/browser-react';

configure({ reactStrictMode: true });
```

### Pure entry

The `/pure` entry (`@rstest/browser-react/pure`) exports the same API but without automatic cleanup registration. Use it when you need manual control over cleanup timing:

```tsx
import { cleanup, render } from '@rstest/browser-react/pure';
import { afterEach } from '@rstest/core';

afterEach(async () => {
  await cleanup();
});
```

## API reference

### Exports

The default entry (`@rstest/browser-react`) exports:

- `render` - Render a React element into the DOM
- `renderHook` - Render a custom hook for testing
- `cleanup` - Unmount all rendered components
- `act` - Wrap state updates for proper batching
- `configure` - Configure render behavior (e.g., React Strict Mode)

Type exports:

- `RenderOptions` - Options for `render()`
- `RenderResult` - Return type of `render()`
- `RenderHookOptions` - Options for `renderHook()`
- `RenderHookResult` - Return type of `renderHook()`
- `RenderConfiguration` - Options for `configure()`

The `/pure` entry exports the same API but does not register automatic cleanup hooks.

### `render(ui, options?)`

Renders a React element into the DOM.

```typescript
function render(ui: ReactNode, options?: RenderOptions): Promise<RenderResult>;

interface RenderOptions {
  /** Custom container element to render into */
  container?: HTMLElement;
  /** Base element for queries, defaults to document.body */
  baseElement?: HTMLElement;
  /** Wrapper component (e.g., for providers/context) */
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}

interface RenderResult {
  /** The container element the component is rendered into */
  container: HTMLElement;
  /** The base element for queries, defaults to document.body */
  baseElement: HTMLElement;
  /** Unmount the rendered component */
  unmount: () => Promise<void>;
  /** Re-render the component with new props/element */
  rerender: (ui: ReactNode) => Promise<void>;
  /** Returns the rendered UI as a DocumentFragment (useful for snapshots) */
  asFragment: () => DocumentFragment;
}
```

### `renderHook(callback, options?)`

Renders a custom React hook for testing.

```typescript
function renderHook<Props, Result>(
  callback: (props?: Props) => Result,
  options?: RenderHookOptions<Props>,
): Promise<RenderHookResult<Result, Props>>;

interface RenderHookOptions<Props> extends RenderOptions {
  /** Initial props passed to the hook */
  initialProps?: Props;
}

interface RenderHookResult<Result, Props> {
  /** Reference to the latest hook return value */
  result: { current: Result };
  /** Re-render the hook with new props */
  rerender: (props?: Props) => Promise<void>;
  /** Unmount the hook */
  unmount: () => Promise<void>;
  /** Access to act for manual state updates */
  act: (callback: () => unknown) => Promise<void>;
}
```

### `act(callback)`

Wraps state updates in React's `act()` for proper batching. Automatically manages the `IS_REACT_ACT_ENVIRONMENT` global.

```typescript
function act(callback: () => unknown): Promise<void>;
```

> **Note:** For React 17 (which doesn't export `act`), this function falls back to simple async execution.

### `cleanup()`

Unmounts all rendered components and removes their containers from the DOM.

Called automatically **before** each test when using the default entry. This timing allows you to inspect the DOM after a test failure.

```typescript
function cleanup(): Promise<void>;
```

### `configure(options)`

Configure render behavior.

```typescript
function configure(options: Partial<RenderConfiguration>): void;

interface RenderConfiguration {
  /** Enable React StrictMode wrapper (default: false) */
  reactStrictMode: boolean;
}
```

## Compatibility

- React 17, 18, and 19
- Rstest browser mode
- Node.js >= 18.12.0

## License

MIT
