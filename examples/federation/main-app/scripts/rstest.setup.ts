import { spawn } from 'node:child_process';
import { closeSync, openSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import killPort from 'kill-port';

type TrackedChild = {
  name: string;
  child: ReturnType<typeof spawn>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    // If another worker created the lock but the server never came up (or was killed),
    // proactively remove the stale lock and let this worker become the owner.
    if (globalThis.__RSTEST_MF_OWNER__ === false) {
      const reachable = await isUrlReachable(url);
      if (!reachable) {
        try {
          rmSync(lockFile, { force: true });
        } catch {}
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const ensureNodeRemoteImpl = async () => {
  // Fast path if already reachable.
  if (await isUrlReachable(remoteEntryUrl, 500)) return;

  // Try to become the owner (cross-worker).
  let fd: number | null = null;
  try {
    fd = openSync(lockFile, 'wx');
    globalThis.__RSTEST_MF_OWNER__ = true;
  } catch (e: any) {
    if (e?.code === 'EEXIST') {
      // Another worker is (supposedly) starting it; wait, but allow stale lock recovery.
      globalThis.__RSTEST_MF_OWNER__ = false;
      await waitForUrl(remoteEntryUrl);
      return;
    }
    throw e;
  } finally {
    if (fd !== null) closeSync(fd);
  }

  // Owner path: build, serve, wait.
  void killPort(3001).catch(() => {});
  void killPort(3003).catch(() => {});
  void killPort(3004).catch(() => {});
  await run(componentAppDir, 'pnpm', ['build:node']);
  await run(componentAppDir, 'pnpm', ['build']);
  globalThis.__RSTEST_MF_CHILDREN__.push(
    start('component-app(node)', componentAppDir, 'pnpm', ['serve:node']),
  );
  globalThis.__RSTEST_MF_CHILDREN__.push(
    start('component-app(web)', componentAppDir, 'pnpm', ['serve']),
  );
  await waitForUrl(remoteEntryUrl);
  await run(nodeLocalDir, 'pnpm', ['build:node']);
  await run(nodeLocalDir, 'pnpm', ['build']);
  globalThis.__RSTEST_MF_CHILDREN__.push(
    start('node-local-remote(web)', nodeLocalDir, 'pnpm', ['serve']),
  );
  await waitForUrl('http://localhost:3001/remoteEntry.js');
  await waitForUrl('http://localhost:3004/remoteEntry.js');
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
const remoteEntryUrl = 'http://localhost:3003/remoteEntry.js';

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
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: workerEnv,
  });
  return { name, child };
};

const run = async (cwd: string, cmd: string, args: string[]) => {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: workerEnv });
  await new Promise<void>((resolveRun, rejectRun) => {
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else
        rejectRun(
          new Error(`${cmd} ${args.join(' ')} exited with code ${code}`),
        );
    });
    child.once('error', rejectRun);
  });
};

export const cleanupNodeRemote = async () => {
  // Kill by port first (covers detached/extra processes).
  await killPort(3003).catch(() => {});

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
