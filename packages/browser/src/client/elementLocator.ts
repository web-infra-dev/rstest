import { ELEMENT_LOCATOR_REGISTRY_KEY } from '../elementLocator';
import { createRequestId } from './dispatchTransport';

export const isDomElement = (value: unknown): value is Element =>
  typeof Element !== 'undefined' && value instanceof Element;

export const registerElementLocator = (element: Element): string => {
  if (!isDomElement(element) || element.ownerDocument !== document) {
    throw new TypeError(
      'page.elementLocator() expects a DOM Element from the current test document.',
    );
  }

  let registry = window[ELEMENT_LOCATOR_REGISTRY_KEY];
  if (!registry) {
    const elements = new Map<string, WeakRef<Element>>();
    registry = {
      documentId: createRequestId('element-document'),
      nextId: 0,
      ids: new WeakMap(),
      elements,
      finalizer: new FinalizationRegistry((id) => elements.delete(id)),
    };
    window[ELEMENT_LOCATOR_REGISTRY_KEY] = registry;
  }

  let id = registry.ids.get(element);
  if (!id) {
    id = `${registry.documentId}:${registry.nextId++}`;
    registry.ids.set(element, id);
    registry.elements.set(id, new WeakRef(element));
    registry.finalizer.register(element, id);
  }
  return id;
};
