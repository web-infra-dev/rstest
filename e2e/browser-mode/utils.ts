import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRstestCli } from '../scripts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        env: extra?.env,
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
        env: { DEBUG: 'rstest', ...extra?.env },
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
        env: extra?.env,
      },
    },
  });
};
