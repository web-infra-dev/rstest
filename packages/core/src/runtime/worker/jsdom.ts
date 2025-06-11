/**
 * This method is modified based on source found in
 * https://github.com/vitest-dev/vitest/blob/6743008309630c699f6b9e65fd763340d6e19e66/packages/vitest/src/integrations/env/jsdom.ts
 */
import type { ConstructorOptions } from 'jsdom';
import type { MaybePromise } from '../../types/utils';

type JSDOMOptions = ConstructorOptions & {
  html?: string | ArrayBufferLike;
  console?: boolean;
};

export interface EnvironmentReturn {
  teardown: (global: any) => MaybePromise<void>;
}

export interface Environment {
  name: string;
  setup: (
    global: any,
    options: Record<string, any>,
  ) => MaybePromise<EnvironmentReturn>;
}

// SEE https://github.com/jsdom/jsdom/blob/master/lib/jsdom/living/interfaces.js
const LIVING_KEYS = [
  'DOMException',
  'URL',
  'URLSearchParams',
  'EventTarget',

  'NamedNodeMap',
  'Node',
  'Attr',
  'Element',
  'DocumentFragment',
  'DOMImplementation',
  'Document',
  'XMLDocument',
  'CharacterData',
  'Text',
  'CDATASection',
  'ProcessingInstruction',
  'Comment',
  'DocumentType',
  'NodeList',
  'RadioNodeList',
  'HTMLCollection',
  'HTMLOptionsCollection',
  'DOMStringMap',
  'DOMTokenList',

  'StyleSheetList',

  'HTMLElement',
  'HTMLHeadElement',
  'HTMLTitleElement',
  'HTMLBaseElement',
  'HTMLLinkElement',
  'HTMLMetaElement',
  'HTMLStyleElement',
  'HTMLBodyElement',
  'HTMLHeadingElement',
  'HTMLParagraphElement',
  'HTMLHRElement',
  'HTMLPreElement',
  'HTMLUListElement',
  'HTMLOListElement',
  'HTMLLIElement',
  'HTMLMenuElement',
  'HTMLDListElement',
  'HTMLDivElement',
  'HTMLAnchorElement',
  'HTMLAreaElement',
  'HTMLBRElement',
  'HTMLButtonElement',
  'HTMLCanvasElement',
  'HTMLDataElement',
  'HTMLDataListElement',
  'HTMLDetailsElement',
  'HTMLDialogElement',
  'HTMLDirectoryElement',
  'HTMLFieldSetElement',
  'HTMLFontElement',
  'HTMLFormElement',
  'HTMLHtmlElement',
  'HTMLImageElement',
  'HTMLInputElement',
  'HTMLLabelElement',
  'HTMLLegendElement',
  'HTMLMapElement',
  'HTMLMarqueeElement',
  'HTMLMediaElement',
  'HTMLMeterElement',
  'HTMLModElement',
  'HTMLOptGroupElement',
  'HTMLOptionElement',
  'HTMLOutputElement',
  'HTMLPictureElement',
  'HTMLProgressElement',
  'HTMLQuoteElement',
  'HTMLScriptElement',
  'HTMLSelectElement',
  'HTMLSlotElement',
  'HTMLSourceElement',
  'HTMLSpanElement',
  'HTMLTableCaptionElement',
  'HTMLTableCellElement',
  'HTMLTableColElement',
  'HTMLTableElement',
  'HTMLTimeElement',
  'HTMLTableRowElement',
  'HTMLTableSectionElement',
  'HTMLTemplateElement',
  'HTMLTextAreaElement',
  'HTMLUnknownElement',
  'HTMLFrameElement',
  'HTMLFrameSetElement',
  'HTMLIFrameElement',
  'HTMLEmbedElement',
  'HTMLObjectElement',
  'HTMLParamElement',
  'HTMLVideoElement',
  'HTMLAudioElement',
  'HTMLTrackElement',
  'HTMLFormControlsCollection',

  'SVGElement',
  'SVGGraphicsElement',
  'SVGSVGElement',
  'SVGGElement',
  'SVGDefsElement',
  'SVGDescElement',
  'SVGMetadataElement',
  'SVGTitleElement',
  'SVGSymbolElement',
  'SVGSwitchElement',

  'SVGAnimatedPreserveAspectRatio',
  'SVGAnimatedRect',
  'SVGAnimatedString',
  'SVGNumber',
  'SVGPreserveAspectRatio',
  'SVGRect',
  'SVGStringList',

  'Event',
  'BeforeUnloadEvent',
  'BlobEvent',
  'CloseEvent',
  'CustomEvent',
  'MessageEvent',
  'ErrorEvent',
  'HashChangeEvent',
  'PopStateEvent',
  'StorageEvent',
  'ProgressEvent',
  'PageTransitionEvent',
  'SubmitEvent',

  'UIEvent',
  'FocusEvent',
  'InputEvent',
  'MouseEvent',
  'KeyboardEvent',
  'TouchEvent',
  'CompositionEvent',
  'WheelEvent',

  'BarProp',
  'External',
  'Location',
  'History',
  'Screen',
  'Performance',
  'Navigator',
  'Crypto',

  'PluginArray',
  'MimeTypeArray',
  'Plugin',
  'MimeType',
  'FileReader',
  'Blob',
  'File',
  'FileList',
  'ValidityState',
  'DOMParser',
  'XMLSerializer',
  'FormData',
  'XMLHttpRequestEventTarget',
  'XMLHttpRequestUpload',
  'XMLHttpRequest',
  'WebSocket',
  'NodeFilter',
  'NodeIterator',
  'TreeWalker',
  'AbstractRange',
  'Range',
  'StaticRange',
  'Selection',
  'Storage',
  'CustomElementRegistry',
  'ElementInternals',
  'ShadowRoot',
  'MutationObserver',
  'MutationRecord',
  'Headers',
  'AbortController',
  'AbortSignal',

  'Uint8Array',
  'Uint16Array',
  'Uint32Array',
  'Uint8ClampedArray',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Float32Array',
  'Float64Array',
  'ArrayBuffer',
  'DeviceMotionEventAcceleration',
  'DeviceMotionEventRotationRate',
  'DOMRectReadOnly',
  'DOMRect',

  // not specified in docs, but is available
  'Image',
  'Audio',
  'Option',

  'CSS',
];

const OTHER_KEYS = [
  'addEventListener',
  'alert',
  'blur',
  'cancelAnimationFrame',
  'close',
  'confirm',
  'createPopup',
  'dispatchEvent',
  'document',
  'focus',
  'frames',
  'getComputedStyle',
  'history',
  'innerHeight',
  'innerWidth',
  'length',
  'location',
  'matchMedia',
  'moveBy',
  'moveTo',
  'name',
  'navigator',
  'open',
  'outerHeight',
  'outerWidth',
  'pageXOffset',
  'pageYOffset',
  'parent',
  'postMessage',
  'print',
  'prompt',
  'removeEventListener',
  'requestAnimationFrame',
  'resizeBy',
  'resizeTo',
  'screen',
  'screenLeft',
  'screenTop',
  'screenX',
  'screenY',
  'scroll',
  'scrollBy',
  'scrollLeft',
  'scrollTo',
  'scrollTop',
  'scrollX',
  'scrollY',
  'self',
  'stop',
  'top',
  'Window',
  'window',
];

export const KEYS: string[] = LIVING_KEYS.concat(OTHER_KEYS);

const skipKeys = ['window', 'self', 'top', 'parent'];

export function getWindowKeys(
  global: any,
  win: any,
  additionalKeys: string[] = [],
): Set<string> {
  const keysArray = [...additionalKeys, ...KEYS];

  return new Set(
    keysArray.concat(Object.getOwnPropertyNames(win)).filter((k) => {
      if (skipKeys.includes(k)) {
        return false;
      }
      if (k in global) {
        return keysArray.includes(k);
      }

      return true;
    }),
  );
}

function isClassLikeName(name: string) {
  return name[0] === name[0]?.toUpperCase();
}

interface PopulateOptions {
  // we bind functions such as addEventListener and others
  // because they rely on `this` in happy-dom, and in jsdom it
  // has a priority for getting implementation from symbols
  // (global doesn't have these symbols, but window - does)
  bindFunctions?: boolean;

  additionalKeys?: string[];
}

export function populateGlobal(
  global: any,
  win: any,
  options: PopulateOptions = {},
): {
  keys: Set<string>;
  skipKeys: string[];
  originals: Map<string | symbol, any>;
} {
  const { bindFunctions = false } = options;
  const keys = getWindowKeys(global, win, options.additionalKeys);

  const originals = new Map<string | symbol, any>();

  const overrideObject = new Map<string | symbol, any>();
  for (const key of keys) {
    const boundFunction =
      bindFunctions && typeof win[key] === 'function' && !isClassLikeName(key)
        ? win[key].bind(win)
        : undefined;

    if (KEYS.includes(key) && key in global) {
      originals.set(key, global[key]);
    }

    Object.defineProperty(global, key, {
      get() {
        if (overrideObject.has(key)) {
          return overrideObject.get(key);
        }
        if (boundFunction) {
          return boundFunction;
        }
        return win[key];
      },
      set(v) {
        overrideObject.set(key, v);
      },
      configurable: true,
    });
  }

  global.window = global;
  global.self = global;
  global.top = global;
  global.parent = global;

  if (global.global) {
    global.global = global;
  }

  // rewrite defaultView to reference the same global context
  if (global.document?.defaultView) {
    Object.defineProperty(global.document, 'defaultView', {
      get: () => global,
      enumerable: true,
      configurable: true,
    });
  }

  for (const k of skipKeys) {
    keys.add(k);
  }

  return {
    keys,
    skipKeys,
    originals,
  };
}

function catchWindowErrors(window: Window) {
  let userErrorListenerCount = 0;
  function throwUnhandledError(e: ErrorEvent) {
    if (userErrorListenerCount === 0 && e.error != null) {
      process.emit('uncaughtException', e.error);
    }
  }
  const addEventListener = window.addEventListener.bind(window);
  const removeEventListener = window.removeEventListener.bind(window);
  window.addEventListener('error', throwUnhandledError);
  window.addEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error') {
      userErrorListenerCount++;
    }
    return addEventListener.apply(this, args);
  };
  window.removeEventListener = function (...args: [any, any, any]) {
    if (args[0] === 'error' && userErrorListenerCount) {
      userErrorListenerCount--;
    }
    return removeEventListener.apply(this, args);
  };
  return function clearErrorHandlers() {
    window.removeEventListener('error', throwUnhandledError);
  };
}

export default (<Environment>{
  name: 'jsdom',
  async setup(global: any, { jsdom = {} }) {
    const { CookieJar, JSDOM, ResourceLoader, VirtualConsole } = await import(
      'jsdom'
    );
    const {
      html = '<!DOCTYPE html>',
      userAgent,
      url = 'http://localhost:3000',
      contentType = 'text/html',
      pretendToBeVisual = true,
      includeNodeLocations = false,
      runScripts = 'dangerously',
      resources,
      console = false,
      cookieJar = false,
      ...restOptions
    } = jsdom as JSDOMOptions;
    const dom = new JSDOM(html, {
      pretendToBeVisual,
      resources:
        resources ??
        (userAgent ? new ResourceLoader({ userAgent }) : undefined),
      runScripts,
      url,
      virtualConsole:
        console && global.console
          ? new VirtualConsole().sendTo(global.console)
          : undefined,
      cookieJar: cookieJar ? new CookieJar() : undefined,
      includeNodeLocations,
      contentType,
      userAgent,
      ...restOptions,
    });

    const { keys, originals } = populateGlobal(global, dom.window, {
      bindFunctions: true,
    });

    const clearWindowErrors = catchWindowErrors(global);

    global.jsdom = dom;

    return {
      teardown(global: any) {
        clearWindowErrors();
        dom.window.close();
        delete global.jsdom;
        for (const key of keys) {
          delete global[key];
        }
        originals.forEach((v, k) => {
          global[k] = v;
        });
      },
    };
  },
});
