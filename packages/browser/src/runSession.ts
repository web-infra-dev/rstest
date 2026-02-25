/**
 * Run generation/session lifecycle contract shared by browser scheduling paths.
 */
export type RunSession = {
  token: number;
  cancelled: boolean;
  cancelSignal: Promise<void>;
  signalCancel: () => void;
  done?: Promise<void>;
};

const createCancelSignal = (): {
  signal: Promise<void>;
  resolve: () => void;
} => {
  let settled = false;
  let resolveSignal: () => void = () => {};

  const signal = new Promise<void>((resolve) => {
    resolveSignal = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
  });

  return {
    signal,
    resolve: resolveSignal,
  };
};

export const createRunSession = (token: number): RunSession => {
  const { signal, resolve } = createCancelSignal();
  return {
    token,
    cancelled: false,
    cancelSignal: signal,
    signalCancel: resolve,
  };
};

type CancelOptions<T extends RunSession> = {
  waitForDone?: boolean;
  onCancel?: (session: T) => Promise<void> | void;
};

/**
 * Canonical run-token lifecycle manager.
 * Centralizes token increment, invalidation, and cancellation semantics.
 */
export class RunSessionLifecycle<T extends RunSession> {
  private currentToken = 0;
  private active: T | null = null;

  get activeSession(): T | null {
    return this.active;
  }

  get activeToken(): number {
    return this.currentToken;
  }

  createSession(factory: (token: number) => T): T {
    const session = factory(++this.currentToken);
    this.active = session;
    return session;
  }

  isTokenActive(token: number): boolean {
    return token === this.currentToken;
  }

  isTokenStale(token: number): boolean {
    return !this.isTokenActive(token);
  }

  invalidateActiveToken(): number {
    this.currentToken += 1;
    return this.currentToken;
  }

  clearIfActive(session: T): void {
    if (this.active === session) {
      this.active = null;
    }
  }

  async cancel(session: T, options?: CancelOptions<T>): Promise<void> {
    const waitForDone = options?.waitForDone ?? true;

    if (!session.cancelled) {
      session.cancelled = true;
      session.signalCancel();
      await options?.onCancel?.(session);
    }

    if (waitForDone) {
      await session.done?.catch(() => {});
    }
  }

  async cancelActive(options?: CancelOptions<T>): Promise<void> {
    if (!this.active) {
      return;
    }
    await this.cancel(this.active, options);
  }
}
