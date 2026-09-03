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

type ColorEnvSource = Readonly<Record<string, string | undefined>>;
type ColorEnv = Partial<Record<'FORCE_COLOR' | 'NO_COLOR', string>>;

interface ForceColorEnvOptions {
  userSetColorEnv?: boolean;
  isAgent?: boolean;
  isColorSupported?: boolean;
}

export const hasUserColorEnv = (env: ColorEnvSource): boolean =>
  env.FORCE_COLOR !== undefined || env.NO_COLOR !== undefined;

export const pickColorEnv = (env: ColorEnvSource): ColorEnv => {
  const colorEnv: ColorEnv = {};
  if (env.FORCE_COLOR !== undefined) {
    colorEnv.FORCE_COLOR = env.FORCE_COLOR;
  }
  if (env.NO_COLOR !== undefined) {
    colorEnv.NO_COLOR = env.NO_COLOR;
  }
  return colorEnv;
};

export const omitColorEnv = (
  env: ColorEnvSource,
): Record<string, string | undefined> => {
  const remainingEnv = { ...env };
  delete remainingEnv.FORCE_COLOR;
  delete remainingEnv.NO_COLOR;
  return remainingEnv;
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
export function getForceColorEnv(options?: ForceColorEnvOptions): {
  FORCE_COLOR?: '0' | '1';
  NO_COLOR?: '1';
} {
  const userSetColorEnv =
    options?.userSetColorEnv ?? hasUserColorEnv(process.env);

  // User explicitly set FORCE_COLOR or NO_COLOR — respect their intent.
  // These vars are already in process.env and will be inherited by workers.
  if (userSetColorEnv) {
    return {};
  }

  const agent = options?.isAgent ?? determineAgent().isAgent;

  // Agent environments (AI coding assistants) consume stdout as plain text.
  // ANSI escapes become noise in their output, so disable colors entirely.
  // Set both standards — some tools only check NO_COLOR, others FORCE_COLOR.
  if (agent) {
    return { NO_COLOR: '1', FORCE_COLOR: '0' };
  }

  const colorSupported = options?.isColorSupported ?? isColorSupported;

  // Normal terminal session with color support — propagate to workers
  // so their piped stdio doesn't suppress colors.
  if (colorSupported) {
    return { FORCE_COLOR: '1' };
  }

  return {};
}

/**
 * Task-time color env for a project. A worker is spawned from the creating
 * task's env and reusable workers are color-env-affine, so import-time color
 * detection matches the project. Both keys are still stated so `setupEnv` can
 * retract stale values within a matched worker as a safeguard. Bun forks may
 * drop `undefined` through JSON IPC, but reuse affinity makes those omitted
 * markers irrelevant to import-time detection.
 */
export const resolveTaskColorEnv = (
  resolvedEnv: ColorEnvSource,
  options?: Omit<ForceColorEnvOptions, 'userSetColorEnv'>,
): {
  FORCE_COLOR: '0' | '1' | undefined;
  NO_COLOR: '1' | undefined;
} => ({
  FORCE_COLOR: undefined,
  NO_COLOR: undefined,
  ...getForceColorEnv({
    ...options,
    userSetColorEnv: hasUserColorEnv(resolvedEnv),
  }),
});

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

const waitForStream = (stream: NodeJS.WritableStream): Promise<void> =>
  new Promise((resolve) => {
    stream.write('', () => {
      resolve();
    });
  });

export const flushOutputStreams = async (): Promise<void> => {
  await waitForStream(process.stderr);
  await waitForStream(process.stdout);
};

const logger: Logger & { stderr: (message: string, ...args: any[]) => void } = {
  ...rslog,
  stderr: (message: string, ...args: any[]) => {
    console.error(message, ...args);
  },
};

export { logger };
