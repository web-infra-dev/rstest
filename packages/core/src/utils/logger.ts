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
import { createColors } from 'picocolors';
import { type Logger, logger as rslog } from 'rslog';
import { determineAgent } from './agent';

export const isDebug = (): boolean => {
  if (!process.env.DEBUG) {
    return false;
  }

  const values = process.env.DEBUG.toLocaleLowerCase().split(',');
  return ['rstest', 'rsbuild', 'builder', '*'].some((key) =>
    values.includes(key),
  );
};

export const ansiEnabled = (): boolean => {
  const isColorSupported = createColors().isColorSupported;
  return !determineAgent().isAgent && isColorSupported;
};

/**
 * Create a picocolors instance that respects runtime FORCE_COLOR / TTY / ansiEnabled().
 * We use createColors() instead of the default export because:
 * 1. The default export evaluates isColorSupported at module load time
 * 2. When bundled, this evaluation happens at build time, not runtime
 * 3. By using createColors(), we can evaluate the color support at runtime
 */
export const color: ReturnType<typeof createColors> = createColors(
  ansiEnabled(),
);

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

const rslogGreet = rslog.greet;
rslog.greet = (message: string) => {
  if (!ansiEnabled()) {
    console.log(message);
    return;
  }
  return rslogGreet(message);
};

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
  if (!ansiEnabled()) {
    return;
  }
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
