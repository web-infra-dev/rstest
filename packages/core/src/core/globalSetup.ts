import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'pathe';
import type { EntryInfo, FormattedError } from '../types';
import { bgColor, color, getForceColorEnv } from '../utils';

let globalTeardownCallbacks: (() => Promise<void> | void)[] = [];

function applyEnvChanges(changes: Record<string, string | undefined>) {
  for (const key in changes) {
    if (changes[key] === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = changes[key];
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type GlobalSetupResponse = {
  __rstest_global_setup__: true;
  id: number;
  result: any;
};

const isGlobalSetupResponse = (
  value: unknown,
): value is GlobalSetupResponse => {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __rstest_global_setup__?: unknown }).__rstest_global_setup__ ===
      true
  );
};

class GlobalSetupWorker {
  private child: ChildProcess | undefined;
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (err: Error) => void }
  >();

  start(): ChildProcess {
    if (this.child) return this.child;

    const child = fork(resolve(__dirname, './globalSetupWorker.js'), [], {
      execArgv: [
        ...process.execArgv,
        '--experimental-vm-modules',
        '--experimental-import-meta-resolve',
        '--no-warnings',
      ],
      env: {
        NODE_ENV: 'test',
        ...getForceColorEnv(),
        ...process.env,
      } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced',
    });

    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));

    child.on('message', (message: unknown) => {
      if (!isGlobalSetupResponse(message)) return;
      const handler = this.pending.get(message.id);
      if (!handler) return;
      this.pending.delete(message.id);
      handler.resolve(message.result);
    });

    child.on('exit', () => {
      const error = new Error('[rstest] global setup worker exited');
      for (const handler of this.pending.values()) {
        handler.reject(error);
      }
      this.pending.clear();
      this.child = undefined;
    });

    this.child = child;
    return child;
  }

  call<T>(
    payload: { type: 'setup'; payload: any } | { type: 'teardown' },
  ): Promise<T> {
    const child = this.start();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        child.send({ __rstest_global_setup__: true, id, ...payload });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      try {
        child.kill('SIGTERM');
      } catch {
        resolve();
      }
    });
    this.child = undefined;
  }
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
  const worker = new GlobalSetupWorker();

  const result = await worker.call<{
    success: boolean;
    hasTeardown?: boolean;
    envChanges?: Record<string, string | undefined>;
    errors?: FormattedError[];
  }>({
    type: 'setup',
    payload: {
      entries: globalSetupEntries,
      assetFiles,
      interopDefault,
      outputModule,
      sourceMaps,
    },
  });

  if (result.success) {
    // Apply environment variable changes to main process
    if (result.envChanges) {
      applyEnvChanges(result.envChanges);
    }

    if (result.hasTeardown) {
      globalTeardownCallbacks.push(() => runWorkerTeardown(worker));
    } else {
      await worker.close();
    }
  } else {
    await worker.close();
  }
  return {
    success: result.success,
    errors: result.errors,
  };
}

async function runWorkerTeardown(worker: GlobalSetupWorker): Promise<void> {
  const result = await worker.call<{ success: boolean }>({ type: 'teardown' });
  if (!result.success) {
    process.exitCode = 1;
  }

  await worker.close();
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
