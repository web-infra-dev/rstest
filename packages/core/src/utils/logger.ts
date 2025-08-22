/**
 * Logging message case convention:
 *
 * Info, ready, success and debug messages:
 * - Start with lowercase
 * - Example: "info  build started..."
 *
 * Errors and warnings:
 * - Start with uppercase
 * - Example: "error  Failed to build"
 *
 * This convention helps distinguish between normal operations
 * and important alerts that require attention.
 */
import { type Logger, logger } from 'rslog';
import { color } from './helper';

// Modified based on https://github.com/vitest-dev/vitest/blob/34f67546df3848c66bcdfa48f5221717d498b965/packages/vitest/src/node/logger.ts#L28-L34
const ESC = '\x1b[';
const CLEAR_SCREEN = '\x1Bc';
const ERASE_SCROLLBACK = `${ESC}3J`;

export const isDebug = (): boolean => {
  if (!process.env.DEBUG) {
    return false;
  }

  const values = process.env.DEBUG.toLocaleLowerCase().split(',');
  return ['rstest', 'rsbuild', 'builder', '*'].some((key) =>
    values.includes(key),
  );
};

// setup the logger level
if (isDebug()) {
  logger.level = 'verbose';
}

function getTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

export const clearScreen = (): void => {
  console.log(`${CLEAR_SCREEN}${ERASE_SCROLLBACK}`);
};

logger.override({
  debug: (message, ...args) => {
    if (logger.level !== 'verbose') {
      return;
    }
    const time = color.gray(getTime());
    console.log(`  ${color.magenta('rstest')} ${time} ${message}`, ...args);
  },
});

export { logger };
export type { Logger };
