import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'pathe';
import { type Options, Tinypool } from 'tinypool';
import type { EntryInfo } from '../types';
import { ansiEnabled, bgColor, color } from '../utils';

let globalTeardownCallbacks: (() => Promise<void> | void)[] = [];

function applyEnvChanges(changes: Record<string, string | undefined>) {
  for (const key in changes) {
    if (changes[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = changes[key];
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function createSetupPool() {
  const options: Options = {
    runtime: 'child_process',
    filename: resolve(__dirname, './globalSetupWorker.js'),
    execArgv: [
      ...process.execArgv,
      '--experimental-vm-modules',
      '--experimental-import-meta-resolve',
      '--no-warnings',
    ],
    maxThreads: 1,
    minThreads: 1,
    concurrentTasksPerWorker: 1,
    isolateWorkers: false,
    env: {
      NODE_ENV: 'test',
      ...process.env,
      // enable diff color by default
      FORCE_COLOR: ansiEnabled() ? (process.env.FORCE_COLOR ?? '1') : '0',
    },
  };

  const pool = new Tinypool(options);

  return pool;
}

export async function runGlobalSetup({
  globalSetupEntries,
  assetFiles,
  sourceMaps,
  interopDefault,
  outputModule,
}: {
  globalSetupEntries: EntryInfo[];
  assetFiles: Record<string, string>;
  sourceMaps: Record<string, string>;
  interopDefault: boolean;
  outputModule: boolean;
}): Promise<{
  success: boolean;
  errors?: any[];
}> {
  const pool = await createSetupPool();

  const result = await pool.run({
    type: 'setup',
    entries: globalSetupEntries,
    assetFiles,
    interopDefault,
    outputModule,
    sourceMaps,
  });

  if (result.success) {
    // Apply environment variable changes to main process
    if (result.envChanges) {
      applyEnvChanges(result.envChanges);
    }

    if (result.hasTeardown) {
      globalTeardownCallbacks.push(() => runWorkerTeardown(pool));
    }
  }
  return {
    success: result.success,
    errors: result.errors,
  };
}

async function runWorkerTeardown(pool: Tinypool): Promise<void> {
  const result = await pool.run({
    type: 'teardown',
  });
  if (!result.success) {
    process.exitCode = 1;
  }

  await pool.destroy();
}

export async function runGlobalTeardown(): Promise<void> {
  const teardownCallbacks = [...globalTeardownCallbacks];
  globalTeardownCallbacks = [];

  // Run teardown in reverse order (LIFO - Last In, First Out)
  for (const teardown of teardownCallbacks.reverse()) {
    try {
      await teardown();
    } catch (error) {
      console.error(bgColor('bgRed', 'Error during global teardown'));
      if (error instanceof Error) {
        error.stack
          ? console.error(color.red(error.stack))
          : console.error(color.red(error.message));
      } else {
        console.error(color.red(String(error)));
      }

      process.exitCode = 1;
    }
  }
}
