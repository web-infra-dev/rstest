import { getRealTimers } from '@rstest/core/internal/browser-runtime';
import { createSerialTaskQueue } from '../serialTaskQueue';
import { parseViewportSize } from '../viewport';
import { callBrowserRpc } from './browserRpc';
import { getRpcTimeout, setRpcPhase } from './dispatchTransport';

let originalViewport: { width: number; height: number } | undefined;
const viewportQueue = createSerialTaskQueue();
let pendingViewportChanges = 0;
let isRunningConcurrentTests: (() => boolean) | undefined;

export const setViewportConcurrencyReader = (reader: () => boolean): void => {
  isRunningConcurrentTests = reader;
};

const restoreViewport = async (): Promise<void> => {
  if (!originalViewport) return;
  setRpcPhase('framework');
  try {
    await callBrowserRpc<void>({
      kind: 'viewport',
      locator: { steps: [] },
      method: 'reset',
      args: [],
    });
    originalViewport = undefined;
  } finally {
    setRpcPhase('test');
  }
};

export const resetViewport = (): Promise<void> | undefined => {
  if (!originalViewport && pendingViewportChanges === 0) return;
  const timeout = getRpcTimeout('framework');
  const timers = getRealTimers();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    viewportQueue.enqueue(restoreViewport),
    new Promise<never>((_, reject) => {
      timer = timers.setTimeout?.(() => {
        reject(
          new Error(`Viewport cleanup did not finish within ${timeout}ms`),
        );
      }, timeout);
    }),
  ]).finally(() => {
    if (timer) timers.clearTimeout?.(timer);
  });
};

export const viewport = async (
  width: number,
  height: number,
): Promise<void> => {
  parseViewportSize(width, height);
  if (isRunningConcurrentTests?.()) {
    throw new Error(
      'page.viewport() cannot be used in concurrent tests because they share a viewport.',
    );
  }
  pendingViewportChanges++;
  try {
    await viewportQueue.enqueue(async () => {
      if (width === window.innerWidth && height === window.innerHeight) return;
      originalViewport ??= {
        width: window.innerWidth,
        height: window.innerHeight,
      };
      if (
        width === originalViewport.width &&
        height === originalViewport.height
      ) {
        await restoreViewport();
        return;
      }
      await callBrowserRpc<void>({
        kind: 'viewport',
        locator: { steps: [] },
        method: 'set',
        args: [width, height],
      });
    });
  } finally {
    pendingViewportChanges--;
  }
};
