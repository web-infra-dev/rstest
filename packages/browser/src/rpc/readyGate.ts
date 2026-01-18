export type ReadyGate = {
  isReady: () => boolean;
  markReady: () => void;
  reset: () => void;
  wait: () => Promise<void>;
};

export const createReadyGate = (): ReadyGate => {
  let ready = false;
  let resolveReady: (() => void) | null = null;

  const reset = (): void => {
    ready = false;
    resolveReady = null;
  };

  const isReady = (): boolean => ready;

  const markReady = (): void => {
    if (!ready) {
      ready = true;
      resolveReady?.();
      resolveReady = null;
    }
  };

  const wait = async (): Promise<void> => {
    if (ready) {
      return;
    }
    if (resolveReady) {
      await new Promise<void>((resolve) => {
        const prevResolve = resolveReady;
        resolveReady = () => {
          prevResolve?.();
          resolve();
        };
      });
      return;
    }
    await new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  };

  return {
    isReady,
    markReady,
    reset,
    wait,
  };
};
