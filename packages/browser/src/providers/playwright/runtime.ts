import type {
  BrowserConsoleMessage,
  BrowserProviderContext,
  BrowserProviderPage,
  BrowserProviderRuntime,
} from '../index';

type PlaywrightPageLike = Omit<
  BrowserProviderPage,
  'on' | typeof Symbol.asyncDispose
> & {
  on: {
    (event: 'popup', listener: (page: PlaywrightPageLike) => void): void;
    (
      event: 'console',
      listener: (message: BrowserConsoleMessage) => void,
    ): void;
  };
};
type PlaywrightContextLike = Omit<
  BrowserProviderContext,
  'newPage' | typeof Symbol.asyncDispose
> & {
  newPage: () => Promise<PlaywrightPageLike>;
};

type AsyncDisposableResource<T> = T & {
  [Symbol.asyncDispose]: () => Promise<void>;
};

const patchedPages = new WeakSet<PlaywrightPageLike>();
const patchedContexts = new WeakSet<PlaywrightContextLike>();

const withAsyncDispose = <T extends { close: () => Promise<void> }>(
  resource: T,
): AsyncDisposableResource<T> => {
  Object.defineProperty(resource, Symbol.asyncDispose, {
    configurable: true,
    value: () => resource.close(),
  });

  return resource as AsyncDisposableResource<T>;
};

const wrapPage = (page: PlaywrightPageLike): BrowserProviderPage => {
  if (patchedPages.has(page)) {
    return withAsyncDispose(page) as BrowserProviderPage;
  }

  patchedPages.add(page);
  const originalOn = page.on.bind(page);
  page.on = ((
    event: 'popup' | 'console',
    listener:
      | ((page: BrowserProviderPage) => void)
      | ((message: BrowserConsoleMessage) => void),
  ) => {
    if (event === 'popup') {
      originalOn(event, (popup) => {
        (listener as (page: BrowserProviderPage) => void)(wrapPage(popup));
      });
      return;
    }

    originalOn(event, listener as (message: BrowserConsoleMessage) => void);
  }) as PlaywrightPageLike['on'];

  return withAsyncDispose(page) as BrowserProviderPage;
};

const wrapContext = (
  context: PlaywrightContextLike,
): BrowserProviderContext => {
  if (patchedContexts.has(context)) {
    return withAsyncDispose(context) as BrowserProviderContext;
  }

  patchedContexts.add(context);
  const originalNewPage = context.newPage.bind(context);
  context.newPage = async () => wrapPage(await originalNewPage());

  const originalOn = context.on.bind(context);
  context.on = (event, listener) => {
    originalOn(event, (page) => listener(wrapPage(page)));
  };

  return withAsyncDispose(context) as BrowserProviderContext;
};

export async function launchPlaywrightBrowser({
  browserName,
  headless,
  providerOptions,
}: {
  browserName: 'chromium' | 'firefox' | 'webkit';
  headless: boolean | undefined;
  providerOptions: Record<string, unknown>;
}): Promise<BrowserProviderRuntime> {
  const playwright = await import('playwright');
  const browserType = playwright[browserName];
  const launchOptions = providerOptions.launch as
    | Record<string, unknown>
    | undefined;
  const launchArgs = Array.isArray(launchOptions?.args)
    ? launchOptions.args
    : browserName === 'chromium'
      ? [
          '--disable-popup-blocking',
          '--no-first-run',
          '--no-default-browser-check',
        ]
      : undefined;

  const browser = await browserType.launch({
    ...launchOptions,
    headless,
    args: launchArgs,
  });

  const wrappedBrowser: BrowserProviderRuntime['browser'] = {
    close: async () => browser.close(),
    [Symbol.asyncDispose]: async () => browser.close(),
    newContext: async ({
      providerOptions: contextProviderOptions,
      viewport,
    }) => {
      const contextOptions = contextProviderOptions?.context as
        | Record<string, unknown>
        | undefined;
      const context = await browser.newContext({
        ...contextOptions,
        viewport,
      });

      return wrapContext(context as unknown as PlaywrightContextLike);
    },
  };

  return {
    browser: wrappedBrowser,
  };
}
