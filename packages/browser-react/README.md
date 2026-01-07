# @rstest/browser-react

React component testing support for [Rstest](https://rstest.dev) browser mode.

## Installation

```bash
npm install @rstest/browser-react
# or
pnpm add @rstest/browser-react
```

## Usage

### Basic component testing

```tsx
import { render, cleanup } from '@rstest/browser-react';
import { screen } from '@testing-library/dom';
import { expect, test } from '@rstest/core';

test('renders button', async () => {
  await render(<button>Click me</button>);
  expect(screen.getByRole('button')).toBeTruthy();
});
```

### Testing with wrapper (providers/context)

```tsx
import { render } from '@rstest/browser-react';

const Wrapper = ({ children }) => (
  <ThemeProvider theme="dark">{children}</ThemeProvider>
);

test('renders with theme', async () => {
  await render(<MyComponent />, { wrapper: Wrapper });
});
```

### Testing hooks

```tsx
import { renderHook } from '@rstest/browser-react';
import { useState } from 'react';

test('useState hook', async () => {
  const { result, rerender } = await renderHook(() => useState(0));

  expect(result.current[0]).toBe(0);

  await result.current[1](1);
  await rerender();

  expect(result.current[0]).toBe(1);
});
```

### Manual cleanup with pure entry

```tsx
import { render, cleanup } from '@rstest/browser-react/pure';
import { afterEach } from '@rstest/core';

// No auto-cleanup, manage it yourself
afterEach(async () => {
  await cleanup();
});
```

### Enabling React strict mode

```tsx
import { configure } from '@rstest/browser-react/pure';

configure({ reactStrictMode: true });
```

## API

### `render(ui, options?)`

Renders a React element into the DOM.

**Returns:** `Promise<RenderResult>`

```typescript
interface RenderResult {
  container: HTMLElement;
  baseElement: HTMLElement;
  unmount: () => Promise<void>;
  rerender: (ui: ReactNode) => Promise<void>;
  asFragment: () => DocumentFragment;
}

interface RenderOptions {
  container?: HTMLElement;
  baseElement?: HTMLElement;
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}
```

### `renderHook(callback, options?)`

Renders a custom React hook for testing.

**Returns:** `Promise<RenderHookResult>`

```typescript
interface RenderHookResult<Result, Props> {
  result: { current: Result };
  rerender: (props?: Props) => Promise<void>;
  unmount: () => Promise<void>;
  act: (callback: () => unknown) => Promise<void>;
}
```

### `cleanup()`

Unmounts all mounted components. Called automatically before each test when using the default entry.

### `act(callback)`

Wraps a callback in React's `act()` for proper state updates.

### `configure(options)` (pure entry only)

Configure render behavior.

```typescript
interface RenderConfiguration {
  reactStrictMode: boolean;
}
```

## Using with @testing-library/dom

This package provides React rendering utilities. For DOM queries (`getByRole`, `getByText`, etc.), install `@testing-library/dom`:

```bash
npm install @testing-library/dom
```

```tsx
import { render } from '@rstest/browser-react';
import { screen, fireEvent } from '@testing-library/dom';

test('button click', async () => {
  await render(<Counter />);

  const button = screen.getByRole('button');
  fireEvent.click(button);

  expect(screen.getByText('1')).toBeTruthy();
});
```

## Compatibility

- React 17, 18, and 19
- Node.js >= 18.12.0

## License

MIT
