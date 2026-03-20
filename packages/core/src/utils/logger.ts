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
import { createColors, isColorSupported } from 'picocolors';
import { type Logger, logger as rslog } from 'rslog';
import { determineAgent } from './agent/detectAgent';
import { isTTY } from './helper';

export { isColorSupported };

export const isDebug = (): boolean => {
  if (!process.env.DEBUG) {
    return false;
  }

  const values = process.env.DEBUG.toLocaleLowerCase().split(',');
  return ['rstest', 'rsbuild', 'builder', '*'].some((key) =>
    values.includes(key),
  );
};

/**
 * Determine color env vars (`FORCE_COLOR` / `NO_COLOR`) to inject into
 * worker and child processes (e.g. globalSetup, pool workers).
 *
 * Why this is needed:
 * Workers are spawned with piped stdio (no TTY), so color-detection
 * libraries (picocolors, chalk, jest-diff) always conclude "no color".
 * Without explicit env vars, diff output and reporter output in workers
 * lose all ANSI styling even when the user's terminal supports it.
 *
 * The returned object is spread into the child's `env`; an empty object
 * means "inherit whatever the user already set in process.env".
 *
 * @param options - Override runtime values for unit-testing without mocks.
 */
export function getForceColorEnv(options?: {
  userSetColorEnv?: boolean;
  isAgent?: boolean;
  isColorSupported?: boolean;
}): {
  FORCE_COLOR?: '0' | '1';
  NO_COLOR?: '1';
} {
  const userSetColorEnv =
    options?.userSetColorEnv ??
    (process.env.FORCE_COLOR !== undefined ||
      process.env.NO_COLOR !== undefined);
  const agent = options?.isAgent ?? determineAgent().isAgent;
  const colorSupported = options?.isColorSupported ?? isColorSupported;

  // User explicitly set FORCE_COLOR or NO_COLOR — respect their intent.
  // These vars are already in process.env and will be inherited by workers.
  if (userSetColorEnv) {
    return {};
  }

  // Agent environments (AI coding assistants) consume stdout as plain text.
  // ANSI escapes become noise in their output, so disable colors entirely.
  // Set both standards — some tools only check NO_COLOR, others FORCE_COLOR.
  if (agent) {
    return { NO_COLOR: '1', FORCE_COLOR: '0' };
  }

  // Normal terminal session with color support — propagate to workers
  // so their piped stdio doesn't suppress colors.
  if (colorSupported) {
    return { FORCE_COLOR: '1' };
  }

  return {};
}

/**
 * Create a picocolors instance using default runtime detection.
 */
export const color: ReturnType<typeof createColors> = createColors();

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
  if (!isTTY('stdout')) return;
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

export type { Logger };
export { logger };
