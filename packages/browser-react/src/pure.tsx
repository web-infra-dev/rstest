import type { JSXElementConstructor, ReactNode } from 'react';
import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { act } from './act';

// ===== Types =====

export interface RenderResult {
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

export interface RenderOptions {
  /** Custom container element to render into */
  container?: HTMLElement;
  /** Base element for queries, defaults to document.body */
  baseElement?: HTMLElement;
  /** Wrapper component (e.g., for providers/context) */
  wrapper?: JSXElementConstructor<{ children: ReactNode }>;
}

export interface RenderHookOptions<Props> extends RenderOptions {
  /** Initial props passed to the hook */
  initialProps?: Props;
}

export interface RenderHookResult<Result, Props> {
  /** Reference to the latest hook return value */
  result: { current: Result };
  /** Re-render the hook with new props */
  rerender: (props?: Props) => Promise<void>;
  /** Unmount the hook */
  unmount: () => Promise<void>;
  /** Access to act for manual state updates */
  act: (callback: () => unknown) => Promise<void>;
}

export interface RenderConfiguration {
  /** Enable React StrictMode wrapper */
  reactStrictMode: boolean;
}

// ===== Internal State =====

interface ReactRoot {
  render: (element: ReactNode) => void;
  unmount: () => void;
}

interface MountedRootEntry {
  container: HTMLElement;
  root: ReactRoot;
}

const mountedContainers = new Set<HTMLElement>();
const mountedRootEntries: MountedRootEntry[] = [];

const config: RenderConfiguration = {
  reactStrictMode: false,
};

// ===== Internal Helpers =====

function createRoot(container: HTMLElement): ReactRoot {
  const root = ReactDOMClient.createRoot(container);
  return {
    render: (element: ReactNode) => root.render(element),
    unmount: () => root.unmount(),
  };
}

function strictModeIfNeeded(ui: ReactNode): ReactNode {
  return config.reactStrictMode
    ? React.createElement(React.StrictMode, null, ui)
    : ui;
}

function wrapUiIfNeeded(
  ui: ReactNode,
  wrapper?: JSXElementConstructor<{ children: ReactNode }>,
): ReactNode {
  return wrapper ? React.createElement(wrapper, null, ui) : ui;
}

// ===== Public API =====

/**
 * Render a React element into the DOM.
 */
export async function render(
  ui: ReactNode,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const { wrapper } = options;
  let { container, baseElement } = options;

  if (!baseElement) {
    baseElement = document.body;
  }

  if (!container) {
    container = baseElement.appendChild(document.createElement('div'));
  }

  let root: ReactRoot;

  if (!mountedContainers.has(container)) {
    root = createRoot(container);

    mountedRootEntries.push({ container, root });
    mountedContainers.add(container);
  } else {
    const entry = mountedRootEntries.find((e) => e.container === container);
    if (!entry) {
      throw new Error('Container is tracked but root entry not found');
    }
    root = entry.root;
  }

  const wrappedUi = wrapUiIfNeeded(strictModeIfNeeded(ui), wrapper);
  await act(() => root.render(wrappedUi));

  return {
    container,
    baseElement,
    unmount: async () => {
      await act(() => root.unmount());
    },
    rerender: async (newUi: ReactNode) => {
      const wrapped = wrapUiIfNeeded(strictModeIfNeeded(newUi), wrapper);
      await act(() => root.render(wrapped));
    },
    asFragment: () => {
      return document
        .createRange()
        .createContextualFragment(container.innerHTML);
    },
  };
}

/**
 * Render a custom React hook for testing.
 */
export async function renderHook<Props, Result>(
  renderCallback: (props?: Props) => Result,
  options: RenderHookOptions<Props> = {},
): Promise<RenderHookResult<Result, Props>> {
  const { initialProps, ...renderOptions } = options;
  const result = { current: undefined as Result };

  function TestComponent({ hookProps }: { hookProps?: Props }): null {
    const value = renderCallback(hookProps);
    React.useEffect(() => {
      result.current = value;
    });
    return null;
  }

  const { rerender: baseRerender, unmount } = await render(
    React.createElement(TestComponent, { hookProps: initialProps }),
    renderOptions,
  );

  return {
    result,
    rerender: async (props?: Props) => {
      await baseRerender(
        React.createElement(TestComponent, { hookProps: props }),
      );
    },
    unmount,
    act,
  };
}

/**
 * Cleanup all mounted components.
 * Call this in beforeEach or afterEach to prevent test pollution.
 */
export async function cleanup(): Promise<void> {
  for (const { root, container } of mountedRootEntries) {
    await act(() => root.unmount());
    if (container.parentNode === document.body) {
      document.body.removeChild(container);
    }
  }
  mountedRootEntries.length = 0;
  mountedContainers.clear();
}

/**
 * Configure render behavior.
 */
export function configure(customConfig: Partial<RenderConfiguration>): void {
  Object.assign(config, customConfig);
}

export { act };
