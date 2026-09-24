import { install } from 'source-map-support';
import type { AssetFiles, SerializedError } from '../../types';
import { getAssetText } from '../../utils/assetFiles';
import { color } from '../../utils/logger';
import { formatTestError } from '../util';
import { applyRuntimeColors } from './color';
import { setFederationDynamicImportOrigin } from './runtimeHooks';
import { installForkTerminationPolicy, installGracefulExit } from './setup';

installGracefulExit();
installForkTerminationPolicy();

let teardownCallbacks: TeardownCallback[] = [];
// Track environment variable changes
let initialEnv: Record<string, string | undefined> = {};
let envChanges: Record<string, string | undefined> = {};

type TeardownCallback = () => Promise<void> | void;

type GlobalSetupExports = {
  default?: unknown;
  setup?: unknown;
  teardown?: unknown;
};

const resolveGlobalSetupExports = async (
  module: unknown,
  testPath: string,
): Promise<TeardownCallback | undefined> => {
  const exports = (module ?? {}) as GlobalSetupExports;

  if (typeof exports.setup === 'function') {
    await exports.setup();
  } else if (typeof exports.default === 'function') {
    return await exports.default();
  } else if (typeof exports.teardown !== 'function') {
    throw new Error(
      `Invalid globalSetup file ${testPath}: must export setup, teardown or a default function`,
    );
  }

  return typeof exports.teardown === 'function'
    ? (exports.teardown as TeardownCallback)
    : undefined;
};

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
  color: boolean;
  entries: {
    distPath: string;
    runtimeDistPath?: string;
    testPath: string;
  }[];
  assetFiles: AssetFiles;
  sourceMaps: Record<string, string>;
  interopDefault: boolean;
  outputModule: boolean;
  federation: boolean;
}): Promise<{
  success: boolean;
  hasTeardown: boolean;
  teardownCount?: number;
  envChanges?: Record<string, string | undefined>;
  errors?: SerializedError[];
}> => {
  try {
    applyRuntimeColors(data.color);
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

    // `mockRuntimeCode.js` gates its Module Federation shims on this
    // worker-wide flag, so it must be set before any setup code is evaluated.
    (globalThis as Record<string, unknown>).__rstest_federation__ =
      data.federation === true;

    for (const entry of data.entries) {
      const { distPath, runtimeDistPath, testPath } = entry;
      setFederationDynamicImportOrigin(data.federation, testPath);
      const { loadModule } = data.outputModule
        ? await import('./loadEsModule')
        : await import('./loadModule');

      const module = await loadModule({
        codeContent: getAssetText(data.assetFiles, distPath),
        distPath,
        runtimeDistPath,
        testPath,
        rstestContext: {
          global,
          console: global.console,
          Error,
        },
        assetFiles: data.assetFiles,
        interopDefault: data.interopDefault,
      });

      const teardownCallback = await resolveGlobalSetupExports(
        module,
        testPath,
      );

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
      errors: await formatTestError(error),
    };
  }
};

type GlobalSetupRequest =
  | { __rstest_global_setup__: true; id: number; type: 'setup'; payload: any }
  | { __rstest_global_setup__: true; id: number; type: 'teardown' };

type GlobalSetupResponse = {
  __rstest_global_setup__: true;
  id: number;
  result: unknown;
};

const isGlobalSetupRequest = (value: unknown): value is GlobalSetupRequest => {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __rstest_global_setup__?: unknown }).__rstest_global_setup__ ===
      true
  );
};

const sendResponse = (id: number, result: unknown): void => {
  const response: GlobalSetupResponse = {
    __rstest_global_setup__: true,
    id,
    result,
  };
  process.send?.(response);
};

process.on('message', async (message: unknown) => {
  if (!isGlobalSetupRequest(message)) {
    return;
  }
  try {
    if (message.type === 'setup') {
      const result = await runGlobalSetup(message.payload);
      sendResponse(message.id, result);
    } else {
      const result = await runGlobalTeardown();
      sendResponse(message.id, result);
    }
  } catch (error) {
    sendResponse(message.id, {
      success: false,
      errors: await formatTestError(error),
    });
  }
});

export const runGlobalTeardown = async (): Promise<{
  success: boolean;
}> => {
  const callbacks = [...teardownCallbacks];
  teardownCallbacks = [];
  let success = true;

  // Run teardown in reverse order (LIFO - Last In, First Out)
  for (const teardown of callbacks.reverse()) {
    try {
      await teardown();
    } catch (error) {
      const message =
        error instanceof Error && error.stack ? error.stack : String(error);
      console.error(color.red(`Error during global teardown: ${message}`));
      success = false;
    }
  }

  return { success };
};
