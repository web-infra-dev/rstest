import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  return await runRstestCli({
    command: 'rstest',
    args: ['run', ...(extra?.args || [])],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures', fixtureName),
        env: { ...defaultEnvOverrides, ...extra?.env },
      },
    },
  });
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
  return await runRstestCli({
    command: 'rstest',
    args: ['watch', '--disableConsoleIntercept', ...(extra?.args || [])],
    options: {
      nodeOptions: {
        cwd: join(__dirname, 'fixtures', fixtureName),
        env: { ...defaultEnvOverrides, DEBUG: 'rstest', ...extra?.env },
      },
    },
  });
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
  return await runRstestCli({
    command: 'rstest',
    args: ['run', ...(extra?.args || [])],
    options: {
      nodeOptions: {
        cwd,
        env: { ...defaultEnvOverrides, ...extra?.env },
      },
    },
  });
};
