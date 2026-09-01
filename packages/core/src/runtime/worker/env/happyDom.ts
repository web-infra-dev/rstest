import { createContext, runInContext } from 'node:vm';
import type { Window as HappyDOMWindow } from 'happy-dom';
import type {
  TestEnvironment,
  TestEnvironmentContext,
  TestEnvironmentReturn,
} from '../../../types';
import { checkPkgInstalled } from '../../util';
import {
  addDefaultErrorHandler,
  installGlobal,
  installObjectURLTracker,
  installTimerTracking,
  type NodeTimerPrimitives,
} from './utils';

type HappyDOMOptions = ConstructorParameters<typeof HappyDOMWindow>[0];
type HappyDOMModule = typeof import('happy-dom');

const loadHappyDOM = async (
  dependency?: HappyDOMModule,
): Promise<HappyDOMModule> => {
  if (!dependency) {
    checkPkgInstalled('happy-dom');
  }
  return dependency ?? import('happy-dom');
};

const createHappyDOMWindow = (
  dependency: HappyDOMModule,
  options: HappyDOMOptions,
  console: Console | undefined,
) => {
  const { Window, GlobalWindow } = dependency;
  // Prefer GlobalWindow so globals such as TextEncoder and Uint8Array are
  // exposed; Window keeps compatibility with older happy-dom releases.
  const WindowClass = GlobalWindow || Window;
  const resolvedOptions = options ?? {};
  return new WindowClass({
    ...resolvedOptions,
    url: resolvedOptions.url || 'http://localhost:3000',
    console,
  });
};

const closeHappyDOMWindow = async (
  win: InstanceType<HappyDOMModule['Window']>,
): Promise<void> => {
  if (win.close && win.happyDOM.abort) {
    await win.happyDOM.abort();
    win.close();
  } else {
    await win.happyDOM.cancelAsync();
  }
};

export const setupEnvironment = async (
  global: typeof globalThis,
  options: HappyDOMOptions,
  context: TestEnvironmentContext,
  dependency?: HappyDOMModule,
): Promise<TestEnvironmentReturn> => {
  const happyDOM = await loadHappyDOM(dependency);
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: global.clearInterval ?? globalThis.clearInterval,
    clearTimeout: global.clearTimeout ?? globalThis.clearTimeout,
    setInterval: global.setInterval ?? globalThis.setInterval,
    setTimeout: global.setTimeout ?? globalThis.setTimeout,
  };
  const win = createHappyDOMWindow(
    happyDOM,
    options,
    console && global.console ? global.console : undefined,
  );
  const cleanupObjectURLs = installObjectURLTracker(
    win.URL as unknown as typeof URL,
    context,
  );

  const cleanupGlobal = installGlobal(global, win, {
    // jsdom doesn't support Request and Response, but happy-dom does
    additionalKeys: ['Request', 'Response', 'MessagePort', 'fetch', 'URL'],
  });
  const cleanupTimers = installTimerTracking(global, nodeTimers, context);

  const cleanupHandler = addDefaultErrorHandler(global as unknown as Window);

  return {
    async teardown() {
      cleanupHandler();
      cleanupTimers();
      cleanupObjectURLs();
      await closeHappyDOMWindow(win);
      cleanupGlobal();
    },
  };
};

export const setupVM = async (
  options: HappyDOMOptions,
  context: TestEnvironmentContext,
  dependency?: HappyDOMModule,
): Promise<{
  context: ReturnType<typeof createContext>;
  teardown: () => Promise<void>;
}> => {
  const happyDOM = await loadHappyDOM(dependency);
  const win = createHappyDOMWindow(happyDOM, options, undefined);
  const vmContext = createContext({});
  const vmGlobal = runInContext('globalThis', vmContext) as typeof globalThis;
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: globalThis.clearInterval,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    setTimeout: globalThis.setTimeout,
  };
  const cleanupObjectURLs = installObjectURLTracker(
    win.URL as unknown as typeof URL,
    context,
  );
  const cleanupGlobal = installGlobal(vmGlobal, win, {
    additionalKeys: ['Request', 'Response', 'MessagePort', 'fetch', 'URL'],
    preserveExistingKeys: true,
  });
  const cleanupTimers = installTimerTracking(vmGlobal, nodeTimers, context);
  const cleanupHandler = addDefaultErrorHandler(vmGlobal as unknown as Window);

  return {
    context: vmContext,
    async teardown() {
      cleanupHandler();
      cleanupTimers();
      cleanupObjectURLs();
      cleanupGlobal();
      await closeHappyDOMWindow(win);
    },
  };
};

export const environment: TestEnvironment<typeof globalThis, HappyDOMOptions> =
  {
    name: 'happy-dom',
    setup: setupEnvironment,
  };
