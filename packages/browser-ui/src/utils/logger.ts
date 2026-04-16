import type { ContainerWindow } from './constants';

/**
 * Check if debug mode is enabled based on browser options.
 */
const isDebug = (): boolean => {
  return (window as ContainerWindow).__RSTEST_BROWSER_OPTIONS__?.debug === true;
};

/**
 * Debug logger for browser-ui.
 * Only logs when debug mode is enabled (DEBUG=rstest on server side).
 */
export const logger = {
  debug: (...args: unknown[]): void => {
    if (isDebug()) {
      console.log(...args);
    }
  },
};
