import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import killPort from 'kill-port';

type TrackedChild = {
  name: string;
  child: ReturnType<typeof spawn>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isPortInUse = async (
  port: number,
  host = '127.0.0.1',
  timeoutMs = 200,
) => {
  return await new Promise<boolean>((resolve) => {
    const socket = connect({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
};

const isUrlReachable = async (url: string, timeoutMs = 300) => {
  const ctrl =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(url, { signal: ctrl?.signal });
      return res.ok;
    }
  } catch {
    // ignore
  } finally {
    clearTimeout(timer);
  }
  return false;
};

const waitForUrl = async (
  url: string,
  {
    timeoutMs = 30_000,
    intervalMs = 200,
  }: { timeoutMs?: number; intervalMs?: number } = {},
) => {
  const startAt = Date.now();

  // Retry until remoteEntry is reachable; this avoids flaky CI due to slow builds.
  // Use the built-in fetch (Node 18+) if present; otherwise fall back to node:http.
  while (Date.now() - startAt < timeoutMs) {
    try {
      if (typeof fetch === 'function') {
        const res = await fetch(url);
        if (res.ok) return;
      } else {
        const { request } = await import('node:http');
        await new Promise<void>((resolveReq, rejectReq) => {
          const req = request(url, (res) => {
            if (
              res.statusCode &&
              res.statusCode >= 200 &&
              res.statusCode < 500
            ) {
              resolveReq();
            } else {
              rejectReq(new Error(`HTTP ${res.statusCode ?? 0}`));
            }
            res.resume();
          });
          req.on('error', rejectReq);
          req.end();
        });
        return;
      }
    } catch {
      // ignore and retry
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const ensureNodeRemoteImpl = async () => {
  console.log(
    '[Federation Setup] Checking if remote server is already running...',
  );
  const need3001 = !(await isUrlReachable(remoteEntryUrl, 500));

  console.log(`[Federation Setup] Port 3001 needs start: ${need3001}`);

  if (!need3001) {
    console.log('[Federation Setup] Server already running, skipping setup');
    return;
  }

  // Try to become the owner (cross-worker).
  for (;;) {
    let fd: number | null = null;
    try {
      fd = openSync(lockFile, 'wx');
      globalThis.__RSTEST_MF_OWNER__ = true;
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e;

      // Another worker is (supposedly) starting it. Wait briefly; if the server
      // never comes up, treat the lock as stale and retry ownership.
      globalThis.__RSTEST_MF_OWNER__ = false;
      try {
        await waitForUrl(remoteEntryUrl, { timeoutMs: 5_000 });
        return;
      } catch {
        try {
          rmSync(lockFile, { force: true });
        } catch {}
      }
    } finally {
      if (fd !== null) closeSync(fd);
    }
  }

  // Owner path: build required outputs, start servers, then wait for all endpoints.
  const inUse = await isPortInUse(3001);
  if (inUse) {
    console.log(
      '[Federation Setup] Cleaning up existing process on port 3001...',
    );
    await killPort(3001).catch(() => {});
    console.log('[Federation Setup] Successfully killed process on port 3001');
  } else {
    console.log('[Federation Setup] No process found on port 3001');
  }

  // Add a small delay to ensure port is fully released
  await sleep(500);

  // Build local commonjs remote first so path-based require works for node tests
  console.log('[Federation Setup] Building node-local-remote (node)...');
  await run(nodeLocalDir, 'pnpm', ['build:node']);
  console.log('[Federation Setup] Building node-local-remote (web)...');
  await run(nodeLocalDir, 'pnpm', ['build']);

  // Build component app for web and start HTTP server on 3001
  console.log('[Federation Setup] Building component-app (web)...');
  await run(componentAppDir, 'pnpm', ['build']);

  console.log(
    '[Federation Setup] Starting component-app server on port 3001...',
  );
  const server = start('component-app(web)', componentAppDir, 'pnpm', [
    'serve',
  ]);
  globalThis.__RSTEST_MF_CHILDREN__!.push(server);

  // Wait for endpoint
  console.log('[Federation Setup] Waiting for server at', remoteEntryUrl);
  await waitForUrl(remoteEntryUrl);
  console.log('[Federation Setup] Server ready!');

  console.log('[Federation Setup] Federation server is running and ready!');
};

declare global {
  // Keep state across test files within the same worker process.
  // eslint-disable-next-line no-var
  var __RSTEST_MF_CHILDREN__: TrackedChild[] | undefined;
  // eslint-disable-next-line no-var
  var __RSTEST_MF_REGISTERED_TEARDOWN__: boolean | undefined;
  // eslint-disable-next-line no-var
  var __RSTEST_MF_OWNER__: boolean | undefined;
}

const workspaceRoot = resolve(__dirname, '..', '..');
const componentAppDir = resolve(workspaceRoot, 'component-app');
const nodeLocalDir = resolve(workspaceRoot, 'node-local-remote');
const lockFile = resolve(workspaceRoot, '.rstest-mf-node-remote.lock');
const remoteEntryUrl = 'http://localhost:3001/remoteEntry.js';

const workerEnv = {
  ...process.env,
  // Rstest runs workers in a stripped environment in some cases; ensure
  // `npx` can find `pnpm` by adding common install locations.
  PATH: [
    process.env.PATH,
    '/usr/local/bin',
    '/opt/homebrew/bin',
    `${process.env.HOME}/.local/bin`,
  ]
    .filter(Boolean)
    .join(':'),
};

const start = (name: string, cwd: string, cmd: string, args: string[]) => {
  console.log(`[Federation Setup] Spawning ${name}: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: workerEnv,
  });

  child.on('error', (err: Error) => {
    console.error(`[Federation Setup] Error in ${name}:`, err);
  });

  child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
    if (code !== null) {
      console.log(`[Federation Setup] ${name} exited with code ${code}`);
    } else if (signal !== null) {
      console.log(
        `[Federation Setup] ${name} terminated with signal ${signal}`,
      );
    }
  });

  return { name, child };
};

const run = async (cwd: string, cmd: string, args: string[]) => {
  const cmdStr = `${cmd} ${args.join(' ')}`;
  console.log(`[Federation Setup] Running: ${cmdStr} in ${cwd}`);
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: workerEnv });
  await new Promise<void>((resolveRun, rejectRun) => {
    child.once('exit', (code: number | null) => {
      if (code === 0) {
        console.log(`[Federation Setup] Successfully completed: ${cmdStr}`);
        resolveRun();
      } else {
        const err = new Error(`${cmdStr} exited with code ${code}`);
        console.error(`[Federation Setup] Failed: ${err.message}`);
        rejectRun(err);
      }
    });
    child.once('error', (err: Error) => {
      console.error(`[Federation Setup] Process error: ${cmdStr}`, err);
      rejectRun(err);
    });
  });
};

export const cleanupNodeRemote = async () => {
  console.log('[Federation Setup] Starting cleanup...');

  const inUse = await isPortInUse(3001);
  if (inUse) {
    await killPort(3001).catch(() => {});
    console.log('[Federation Setup] Killed process on port 3001');
  }

  try {
    rmSync(lockFile, { force: true });
  } catch {}

  // Then kill tracked children (best effort).
  for (const { child } of globalThis.__RSTEST_MF_CHILDREN__ ?? []) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }

  globalThis.__RSTEST_MF_CHILDREN__ = [];
  globalThis.__RSTEST_MF_OWNER__ = false;
};

export const ensureNodeRemote = async () => {
  console.log('[Federation Setup] Starting federation setup...');

  // Keep state across test files within the same worker process.
  globalThis.__RSTEST_MF_CHILDREN__ ??= [];
  globalThis.__RSTEST_MF_OWNER__ ??= false;

  await ensureNodeRemoteImpl();

  // Register a best-effort teardown once per process in case global teardown
  // does not run (e.g. forced exit).
  if (
    globalThis.__RSTEST_MF_OWNER__ &&
    !globalThis.__RSTEST_MF_REGISTERED_TEARDOWN__
  ) {
    globalThis.__RSTEST_MF_REGISTERED_TEARDOWN__ = true;

    process.once('exit', () => {
      // No awaits allowed in exit handler.
      void cleanupNodeRemote();
    });
  }
};
