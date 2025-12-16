import type { EntryInfo } from '../types';
import { bgColor, color } from '../utils';

let globalTeardownCallbacks: Array<() => Promise<void> | void> = [];

export async function runGlobalSetup(
  globalSetupEntries: EntryInfo[],
  assetFiles: Record<string, string>,
  loadModule: (options: {
    codeContent: string;
    distPath: string;
    testPath: string;
    interopDefault: boolean;
  }) => Promise<unknown>,
  interopDefault: boolean,
): Promise<void> {
  if (globalSetupEntries.length === 0) {
    return;
  }

  for (const entry of globalSetupEntries) {
    const { distPath, testPath } = entry;
    const setupCodeContent = assetFiles[distPath]!;

    const module = (await loadModule({
      codeContent: setupCodeContent,
      distPath,
      testPath,
      interopDefault,
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
      globalTeardownCallbacks.push(teardownCallback);
    }
  }
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
