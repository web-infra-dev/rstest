export const ELEMENT_LOCATOR_REGISTRY_KEY = '__RSTEST_ELEMENT_LOCATORS__';
export const ELEMENT_LOCATOR_SELECTOR_ENGINE = 'rstest-element';

type ElementLocatorRegistry = {
  documentId: string;
  nextId: number;
  ids: WeakMap<Element, string>;
  elements: Map<string, WeakRef<Element>>;
  finalizer: FinalizationRegistry<string>;
};

declare global {
  interface Window {
    [ELEMENT_LOCATOR_REGISTRY_KEY]?: ElementLocatorRegistry;
  }
}
