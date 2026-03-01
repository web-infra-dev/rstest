import type {
  BrowserClientMessage,
  BrowserDispatchRequest,
  BrowserDispatchResponse,
} from './protocol';
import { DISPATCH_MESSAGE_TYPE, DISPATCH_RPC_BRIDGE_NAME } from './protocol';
import type { BrowserProviderPage } from './providers';

type HeadlessRunnerTransportHandlers = {
  onDispatchMessage: (message: BrowserClientMessage) => Promise<void>;
  onDispatchRpc: (
    request: BrowserDispatchRequest,
  ) => Promise<BrowserDispatchResponse>;
};

/**
 * Headless transport adapter.
 * This only binds page bridge functions and delegates all scheduling decisions upstream.
 */
export const attachHeadlessRunnerTransport = async (
  page: BrowserProviderPage,
  handlers: HeadlessRunnerTransportHandlers,
): Promise<void> => {
  // Fire-and-forget runner lifecycle messages (ready/log/result/fatal).
  await page.exposeFunction(DISPATCH_MESSAGE_TYPE, handlers.onDispatchMessage);
  // Request/response RPC bridge shared by snapshot and future namespaces.
  await page.exposeFunction(DISPATCH_RPC_BRIDGE_NAME, handlers.onDispatchRpc);
};
