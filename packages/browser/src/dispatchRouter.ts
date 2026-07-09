import type {
  BrowserDispatchRequest,
  BrowserDispatchResponse,
} from './protocol';

type DispatchHandler = (request: BrowserDispatchRequest) => Promise<unknown>;

type HostDispatchRouterOptions = {
  isRunTokenStale?: (runToken: number) => boolean;
  onStale?: (request: BrowserDispatchRequest) => void;
};

const toErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

/**
 * Host-side routing layer for dispatch envelopes.
 * Capabilities are registered by namespace, while routing stays transport-agnostic.
 */
export class HostDispatchRouter {
  private handlers = new Map<string, DispatchHandler>();
  private options: HostDispatchRouterOptions;

  constructor(options?: HostDispatchRouterOptions) {
    this.options = options ?? {};
  }

  register(namespace: string, handler: DispatchHandler): void {
    this.handlers.set(namespace, handler);
  }

  unregister(namespace: string): void {
    this.handlers.delete(namespace);
  }

  has(namespace: string): boolean {
    return this.handlers.has(namespace);
  }

  async dispatch(
    request: BrowserDispatchRequest,
  ): Promise<BrowserDispatchResponse> {
    const runToken = request.runToken;
    if (
      typeof runToken === 'number' &&
      this.options.isRunTokenStale?.(runToken)
    ) {
      // Return a stale marker so callers can drop old-run writes safely.
      this.options.onStale?.(request);
      return {
        requestId: request.requestId,
        runToken,
        stale: true,
      };
    }

    const handler = this.handlers.get(request.namespace);
    if (!handler) {
      return {
        requestId: request.requestId,
        runToken,
        error: `No dispatch handler registered for namespace "${request.namespace}"`,
      };
    }

    try {
      const result = await handler(request);
      return {
        requestId: request.requestId,
        runToken,
        result,
      };
    } catch (error) {
      return {
        requestId: request.requestId,
        runToken,
        error: toErrorMessage(error),
      };
    }
  }
}
