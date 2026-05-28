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

function addPageListener(
  page: PlaywrightPageLike,
  event: 'popup',
  listener: (page: BrowserProviderPage) => void,
): void;
function addPageListener(
  page: PlaywrightPageLike,
  event: 'console',
  listener: (message: BrowserConsoleMessage) => void,
): void;
function addPageListener(
  page: PlaywrightPageLike,
  event: 'popup' | 'console',
  listener:
    | ((page: BrowserProviderPage) => void)
    | ((message: BrowserConsoleMessage) => void),
): void;
function addPageListener(
  page: PlaywrightPageLike,
  event: 'popup' | 'console',
  listener:
    | ((page: BrowserProviderPage) => void)
    | ((message: BrowserConsoleMessage) => void),
) {
  if (event === 'popup') {
    page.on(event, (popup) => {
      (listener as (page: BrowserProviderPage) => void)(wrapPage(popup));
    });
    return;
  }

  page.on(event, listener as (message: BrowserConsoleMessage) => void);
}

const wrapPage = (page: PlaywrightPageLike): BrowserProviderPage => ({
  goto: (url, options) => page.goto(url, options),
  exposeFunction: (name, fn) => page.exposeFunction(name, fn),
  addInitScript: (script) => page.addInitScript(script),
  on: (event, listener) => addPageListener(page, event, listener),
  close: () => page.close(),
  [Symbol.asyncDispose]: () => page.close(),
});

const wrapContext = (
  context: PlaywrightContextLike,
): BrowserProviderContext => ({
  newPage: async () => wrapPage(await context.newPage()),
  on: (event, listener) => {
    context.on(event, (page) => listener(wrapPage(page)));
  },
  close: () => context.close(),
  [Symbol.asyncDispose]: () => context.close(),
});

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
