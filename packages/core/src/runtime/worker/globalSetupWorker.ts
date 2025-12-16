import './setup';
import { install } from 'source-map-support';
import type { FormattedError } from '../../types';
import { color } from '../../utils/helper';
import { formatTestError } from '../util';

let teardownCallbacks: Array<() => Promise<void> | void> = [];
// Track environment variable changes
let initialEnv: Record<string, string | undefined> = {};
let envChanges: Record<string, string | undefined> = {};

function trackEnvChanges() {
  // Store initial environment before setup
  initialEnv = { ...process.env };
}

function captureEnvChanges(): Record<string, string | undefined> {
  const changes: Record<string, string | undefined> = {};

  // Compare current env with initial env
  for (const key in process.env) {
    if (process.env[key] !== initialEnv[key]) {
      changes[key] = process.env[key];
    }
  }

  // Check for deleted env vars
  for (const key in initialEnv) {
    if (!(key in process.env) && initialEnv[key] !== undefined) {
      changes[key] = undefined;
    }
  }

  return changes;
}

const runGlobalSetup = async (data: {
  entries: Array<{
    distPath: string;
    testPath: string;
  }>;
  assetFiles: Record<string, string>;
  sourceMaps: Record<string, string>;
  interopDefault: boolean;
  outputModule: boolean;
}): Promise<{
  success: boolean;
  hasTeardown: boolean;
  teardownCount?: number;
  envChanges?: Record<string, string | undefined>;
  errors?: FormattedError[];
}> => {
  try {
    if (data.entries.length === 0) {
      return { success: true, hasTeardown: false };
    }
    // provides source map support for stack traces
    install({
      environment: 'node',
      handleUncaughtExceptions: false,
      retrieveSourceMap: (source) => {
        if (data.sourceMaps[source]) {
          return {
            url: source,
            map: JSON.parse(data.sourceMaps[source]),
          };
        }
        return null;
      },
    });

    // Start tracking environment changes
    trackEnvChanges();

    for (const entry of data.entries) {
      const { distPath, testPath } = entry;
      const setupCodeContent = data.assetFiles[distPath]!;
      const { loadModule } = data.outputModule
        ? await import('./loadEsModule')
        : await import('./loadModule');

      const module = (await loadModule({
        codeContent: setupCodeContent,
        distPath,
        testPath,
        rstestContext: {
          global,
          console: global.console,
          Error,
        },
        assetFiles: data.assetFiles,
        interopDefault: data.interopDefault,
      })) as any;

      let teardownCallback: (() => Promise<void> | void) | undefined;

      // Handle different global setup file formats
      if (module && typeof module === 'object') {
        // Format 1: Named setup/teardown functions
        if (module.setup && typeof module.setup === 'function') {
          await module.setup();
          if (module.teardown && typeof module.teardown === 'function') {
            teardownCallback = module.teardown;
          }
        }
        // Format 2: Default function returning teardown
        else if (module.default && typeof module.default === 'function') {
          teardownCallback = await module.default();
        }
      }

      if (teardownCallback) {
        teardownCallbacks.push(teardownCallback);
      }
    }

    // Capture environment changes
    envChanges = captureEnvChanges();

    return {
      success: true,
      hasTeardown: teardownCallbacks.length > 0,
      teardownCount: teardownCallbacks.length,
      envChanges,
    };
  } catch (error) {
    return {
      success: false,
      hasTeardown: false,
      errors: formatTestError(error),
    };
  }
};

// Entry point for tinypool worker
export default async function runInPool(options: any): Promise<any> {
  switch (options.type) {
    case 'setup':
      return runGlobalSetup(options);

    case 'teardown':
      return runGlobalTeardown();
  }
}

export const runGlobalTeardown = async (): Promise<{
  success: boolean;
  error?: string;
}> => {
  try {
    const callbacks = [...teardownCallbacks];
    teardownCallbacks = [];

    // Run teardown in reverse order (LIFO - Last In, First Out)
    for (const teardown of callbacks.reverse()) {
      await teardown();
    }

    return {
      success: true,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.stack ? error.stack : String(error);
    console.error(color.red(`Error during global teardown: ${message}`));
    return {
      success: false,
    };
  }
};
