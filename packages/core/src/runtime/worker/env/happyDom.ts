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

export const setupEnvironment = async (
  global: typeof globalThis,
  options: HappyDOMOptions,
  context: TestEnvironmentContext,
  dependency?: HappyDOMModule,
): Promise<TestEnvironmentReturn> => {
  if (!dependency) {
    checkPkgInstalled('happy-dom');
  }

  const { Window, GlobalWindow } = dependency ?? (await import('happy-dom'));
  const nodeTimers: NodeTimerPrimitives = {
    clearInterval: global.clearInterval ?? globalThis.clearInterval,
    clearTimeout: global.clearTimeout ?? globalThis.clearTimeout,
    setInterval: global.setInterval ?? globalThis.setInterval,
    setTimeout: global.setTimeout ?? globalThis.setTimeout,
  };
  // Prefer GlobalWindow to run happy-dom in the global scope so globals like
  // TextEncoder and Uint8Array are correctly exposed; fall back to Window for
  // backward compatibility with older happy-dom versions that lack GlobalWindow.
  const WindowClass = GlobalWindow || Window;
  const resolvedOptions = options ?? {};
  const win = new WindowClass({
    ...resolvedOptions,
    url: resolvedOptions.url || 'http://localhost:3000',
    console: console && global.console ? global.console : undefined,
  });
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
      if (win.close && win.happyDOM.abort) {
        await win.happyDOM.abort();
        win.close();
      } else {
        await win.happyDOM.cancelAsync();
      }
      cleanupGlobal();
    },
  };
};

export const environment: TestEnvironment<typeof globalThis, HappyDOMOptions> =
  {
    name: 'happy-dom',
    setup: setupEnvironment,
  };
