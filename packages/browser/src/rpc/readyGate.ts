export type ReadyGate = {
  isReady: () => boolean;
  markReady: () => void;
  reset: () => void;
  wait: () => Promise<void>;
};

export const createReadyGate = (): ReadyGate => {
  let ready = false;
  const waiters: Array<() => void> = [];

  const reset = (): void => {
    ready = false;
    waiters.length = 0;
  };

  const isReady = (): boolean => ready;

  const markReady = (): void => {
    if (!ready) {
      ready = true;
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
    }
  };

  const wait = async (): Promise<void> => {
    if (ready) {
      return;
    }
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  };

  return {
    isReady,
    markReady,
    reset,
    wait,
  };
};
