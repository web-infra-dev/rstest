export interface RstestExitCode {
  readonly current: number;
  raise(code: number): void;
  reset(): void;
  onChange(listener: (code: number) => void): () => void;
  onCycleEnd(listener: (code: number) => void): () => void;
  finishCycle(): void;
}

export function createExitCode(): RstestExitCode {
  let current = 0;
  const changeListeners = new Set<(code: number) => void>();
  const cycleEndListeners = new Set<(code: number) => void>();

  return {
    get current() {
      return current;
    },
    raise(code) {
      if (code <= current) {
        return;
      }
      current = code;
      for (const listener of changeListeners) {
        listener(code);
      }
    },
    reset() {
      current = 0;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    onCycleEnd(listener) {
      cycleEndListeners.add(listener);
      return () => cycleEndListeners.delete(listener);
    },
    finishCycle() {
      for (const listener of cycleEndListeners) {
        listener(current);
      }
    },
  };
}
