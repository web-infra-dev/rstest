import type { ELEMENT_LOCATOR_REGISTRY_KEY } from '../../elementLocator';

// Playwright serializes this factory into the runner's main world. Keep it
// self-contained so it can read the registry created by the browser client.
export const createElementLocatorEngine = (
  registryKey: typeof ELEMENT_LOCATOR_REGISTRY_KEY,
): {
  query: (root: Node, id: string) => Element | null;
  queryAll: (root: Node, id: string) => Element[];
} => {
  const queryAll = (root: Node, id: string): Element[] => {
    const element = window[registryKey]?.elements.get(id)?.deref();
    if (!element?.isConnected || element.ownerDocument !== document) {
      return [];
    }
    for (let node: Node | null = element; node;) {
      if (node === root) return [element];
      node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
    }
    return [];
  };
  return {
    query: (root, id) => queryAll(root, id)[0] ?? null,
    queryAll,
  };
};
