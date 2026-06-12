import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import treeKill from 'tree-kill';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default env overrides for browser e2e tests.
 * Clear CI-related env vars to prevent them from affecting snapshot behavior.
 * In CI mode, Rstest sets `updateSnapshot: 'none'`, which prevents new snapshots
 * from being created. Since e2e tests often delete and recreate snapshots,
 * this causes all snapshot tests to fail in CI.
 */
const defaultEnvOverrides: Record<string, string> = {
  CI: '',
  GITHUB_ACTIONS: '',
};

const canRunHeadedBrowser =
  process.platform === 'darwin' ||
  process.platform === 'win32' ||
  (process.platform === 'linux' &&
    Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY));

/**
 * Skip headed browser smoke tests locally to avoid popping browser windows.
 * CI runs them when the machine supports headed mode.
 * Set `RSTEST_E2E_RUN_HEADED=true` locally to opt back in.
 */
export const shouldRunHeadedBrowserTests =
  canRunHeadedBrowser &&
  Boolean(process.env.CI || process.env.RSTEST_E2E_RUN_HEADED);

/**
 * Framework-level warnings that the build pipeline must not emit. Browser-mode
 * tests launch rstest as a subprocess, so any Rsbuild/Rspack build warning or
 * Node deprecation notice lands in `cli.stdout`/`cli.stderr` and is otherwise
 * swallowed by the parent test runner. Asserting against this pattern turns
 * silent regressions (e.g. a dynamic import losing its `webpackIgnore` magic
 * comment) into explicit test failures.
 */
const FRAMEWORK_WARNING_PATTERN =
  /Build warning:|Critical dependency:|DeprecationWarning:|\[MODULE_TYPELESS_PACKAGE_JSON\]/;

export const expectNoFrameworkWarnings = (cli: {
  stdout: string;
  stderr: string;
}): void => {
  if (
    !FRAMEWORK_WARNING_PATTERN.test(cli.stdout) &&
    !FRAMEWORK_WARNING_PATTERN.test(cli.stderr)
  ) {
    return;
  }
  const offending = `${cli.stdout}\n${cli.stderr}`
    .split('\n')
    .filter((line) => FRAMEWORK_WARNING_PATTERN.test(line));
  throw new Error(
    `Expected no framework warnings in CLI output, found:\n${offending.join('\n')}`,
  );
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const WINDOWS_PROCESS_CLEANUP_RETRY_COUNT = 40;
const POSIX_PROCESS_CLEANUP_RETRY_COUNT = 20;

type BrowserCli = Awaited<ReturnType<typeof runRstestCli>>['cli'];

/**
 * Kill a spawned rstest process tree without adding a fixed post-kill delay.
 * The tree-kill callback is enough for POSIX cleanup; Windows cleanup retries are
 * handled by deleteFixtureTarget where file handle contention can surface.
 */
export const killCliProcessTree = async (cli: BrowserCli): Promise<void> => {
  const pid = cli.exec.process?.pid;
  if (!pid) {
    cli.exec.kill();
    await sleep(50);
    return;
  }

  await new Promise<void>((resolve) => {
    treeKill(pid, 'SIGKILL', () => resolve());
  });
};

export const deleteFixtureTarget = async (
  fixtureFs: { delete: (targetPath: string) => void } | undefined,
  targetPath: string,
): Promise<void> => {
  if (!fixtureFs) {
    return;
  }

  try {
    fixtureFs.delete(targetPath);
    return;
  } catch (err) {
    if (process.platform !== 'win32') {
      throw err;
    }
  }

  const retryCount =
    process.platform === 'win32'
      ? WINDOWS_PROCESS_CLEANUP_RETRY_COUNT
      : POSIX_PROCESS_CLEANUP_RETRY_COUNT;

  for (let attempt = 0; attempt < retryCount; attempt++) {
    await sleep(50);
    try {
      fixtureFs.delete(targetPath);
      return;
    } catch {
      // Retry briefly on Windows where killed browser processes can release file
      // handles a little after the kill callback fires.
    }
  }
};

/**
 * Run browser mode CLI with specified fixture
 */
export const runBrowserCli = async (
  fixtureName: string,
  extra?: {
    args?: string[];
    env?: Record<string, string>;
  },
) => {
  const args = extra?.args || [];

  const result = await runRstestCli({
    command: 'rstest',
    args: ['run', ...args],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures', fixtureName),
        env: { ...defaultEnvOverrides, ...extra?.env },
      },
    },
  });
  return {
    ...result,
    expectExecSuccess: async () => {
      await result.expectExecSuccess();
      expectNoFrameworkWarnings(result.cli);
    },
  };
};

/**
 * Run browser watch mode CLI with specified fixture
 */
export const runBrowserWatchCli = async (
  fixtureName: string,
  extra?: {
    args?: string[];
    env?: Record<string, string>;
  },
) => {
  const result = await runRstestCli({
    command: 'rstest',
    args: ['watch', '--disableConsoleIntercept', ...(extra?.args || [])],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures', fixtureName),
        env: { ...defaultEnvOverrides, DEBUG: 'rstest', ...extra?.env },
      },
    },
  });
  return {
    ...result,
    expectExecSuccess: async () => {
      await result.expectExecSuccess();
      expectNoFrameworkWarnings(result.cli);
    },
  };
};

/**
 * Run browser mode CLI with custom cwd
 */
export const runBrowserCliWithCwd = async (
  cwd: string,
  extra?: {
    args?: string[];
    env?: Record<string, string>;
  },
) => {
  const result = await runRstestCli({
    command: 'rstest',
    args: ['run', ...(extra?.args || [])],
    options: {
      nodeOptions: {
        cwd,
        env: { ...defaultEnvOverrides, ...extra?.env },
      },
    },
  });
  return {
    ...result,
    expectExecSuccess: async () => {
      await result.expectExecSuccess();
      expectNoFrameworkWarnings(result.cli);
    },
  };
};
