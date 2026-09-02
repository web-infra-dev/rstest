type TimeoutCallback = (...args: any[]) => any;

const wrappedTimeouts = new WeakMap<TimeoutCallback, number>();

export const getWrappedTimeout = (
  callback: TimeoutCallback,
): number | undefined => wrappedTimeouts.get(callback);

export const setWrappedTimeout = (
  callback: TimeoutCallback,
  timeout: number,
): void => {
  wrappedTimeouts.set(callback, timeout);
};

export const inheritWrappedTimeout = <Callback extends TimeoutCallback>(
  source: TimeoutCallback,
  callback: Callback,
): Callback => {
  const timeout = getWrappedTimeout(source);
  if (timeout !== undefined) {
    setWrappedTimeout(callback, timeout);
  }
  return callback;
};
