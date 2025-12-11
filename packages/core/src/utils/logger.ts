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
import { type Logger, logger as rslog } from 'rslog';
import { color } from './helper';

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
  rslog.level = 'verbose';
}

function getTime() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

rslog.override({
  debug: (message, ...args) => {
    if (rslog.level !== 'verbose') {
      return;
    }
    const time = color.gray(getTime());
    console.log(`  ${color.magenta('rstest')} ${time} ${message}`, ...args);
  },
});

export const clearScreen = (force = false): void => {
  if (!isDebug() || force) {
    // clear screen
    console.log('\x1Bc');
  }
};

const logger: Logger & { stderr: (message: string, ...args: any[]) => void } = {
  ...rslog,
  stderr: (message: string, ...args: any[]) => {
    console.error(message, ...args);
  },
};

export { logger };
export type { Logger };
