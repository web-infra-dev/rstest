import type { JSXElementConstructor, ReactNode } from 'react';
import React from 'react';

export interface RenderResult {
  /** The container element the component is rendered into */
  container: HTMLElement;
  /** The base element for queries, defaults to document.body */
  baseElement: HTMLElement;
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
  unmount: () => Promise<void>;
  /** Access to act for manual state updates */
  act: (callback: () => unknown) => Promise<void>;
}

export interface RenderConfiguration {
  /** Enable React StrictMode wrapper */
  reactStrictMode: boolean;
}

/** @internal */
export interface ReactRoot {
  render: (element: ReactNode) => void;
  unmount: () => void;
}

/** @internal */
export type ActFunction = (callback: () => unknown) => Promise<void>;

/** @internal */
export interface RenderApiDeps {
  createRoot: (container: HTMLElement) => ReactRoot;
  act: ActFunction;
}

/** @internal */
export interface RenderApi {
  render: (ui: ReactNode, options?: RenderOptions) => Promise<RenderResult>;
  renderHook: <Props, Result>(
    callback: (props?: Props) => Result,
    options?: RenderHookOptions<Props>,
  ) => Promise<RenderHookResult<Result, Props>>;
  cleanup: () => Promise<void>;
  configure: (customConfig: Partial<RenderConfiguration>) => void;
  act: ActFunction;
}

/** @internal */
export function createRenderApi(deps: RenderApiDeps): RenderApi {
  const { createRoot, act } = deps;

  const roots = new Map<HTMLElement, ReactRoot>();
  const config: RenderConfiguration = {
    reactStrictMode: false,
  };

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

  async function render(
    ui: ReactNode,
    options: RenderOptions = {},
  ): Promise<RenderResult> {
    const { wrapper } = options;
    const baseElement = options.baseElement ?? document.body;
    const container =
      options.container ??
      baseElement.appendChild(document.createElement('div'));

    let root = roots.get(container);
    if (!root) {
      root = createRoot(container);
      roots.set(container, root);
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
      asFragment: () =>
        document.createRange().createContextualFragment(container.innerHTML),
    };
  }

  async function renderHook<Props, Result>(
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

  async function cleanup(): Promise<void> {
    for (const [container, root] of roots) {
      await act(() => root.unmount());
      if (container.parentNode === document.body) {
        document.body.removeChild(container);
      }
    }
    roots.clear();
  }

  function configure(customConfig: Partial<RenderConfiguration>): void {
    Object.assign(config, customConfig);
  }

  return { render, renderHook, cleanup, configure, act };
}
