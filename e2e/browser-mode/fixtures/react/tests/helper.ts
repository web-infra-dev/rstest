import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Enable React act() in browser environment
// @ts-expect-error React requires this global to be set for act() to work
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * Creates a clean container element for React rendering.
 * Cleans up any previous container before creating a new one.
 */
export const createContainer = (): HTMLDivElement => {
  // Clean up previous test's container
  cleanupContainer();

  container = document.createElement('div');
  container.id = 'test-root';
  document.body.appendChild(container);
  root = createRoot(container);
  return container;
};

/**
 * Cleans up the container and unmounts the React root.
 */
export const cleanupContainer = (): void => {
  if (root) {
    const currentRoot = root;
    root = null;
    act(() => {
      currentRoot.unmount();
    });
  }
  if (container?.parentNode) {
    container.parentNode.removeChild(container);
  }
  container = null;
};

/**
 * Renders a React element and waits for the render to complete.
 */
export const render = async (element: React.ReactElement): Promise<void> => {
  if (!root) {
    throw new Error('Container not created. Call createContainer() first.');
  }
  await act(async () => {
    root!.render(element);
  });
};

/**
 * Simulates a click event and waits for React state updates to complete.
 */
export const click = async (
  element: Element | null | undefined,
): Promise<void> => {
  if (!element) {
    throw new Error('Cannot click on null or undefined element');
  }
  await act(async () => {
    element.click();
  });
};

/**
 * Gets the current container element.
 */
export const getContainer = (): HTMLDivElement => {
  if (!container) {
    throw new Error('Container not created. Call createContainer() first.');
  }
  return container;
};
