import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import killPort from 'kill-port';

type TrackedChild = { name: string; child: ReturnType<typeof spawn> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isUrlReachable = async (url: string, timeoutMs = 500) => {
  const ctrl =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    if (typeof fetch === 'function') {
      const res = await fetch(url, { signal: ctrl?.signal });
      return res.ok;
    }
  } catch {
  } finally {
    clearTimeout(timer);
  }
  return false;
};

const waitForUrl = async (
  url: string,
  timeoutMs = 30_000,
  intervalMs = 250,
) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isUrlReachable(url, 500)) return;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url}`);
};

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

const workspaceRoot = resolve(__dirname, '..', '..');
const componentAppDir = resolve(workspaceRoot, 'component-app');
const lockFile = resolve(workspaceRoot, '.rstest-mf-node-remote.lock');
const remoteEntryUrl = 'http://localhost:3001/remoteEntry.js';

const workerEnv = {
  ...process.env,
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
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: workerEnv });
  child.on('error', (err) => {
    console.error(`[Federation Setup] Error in ${name}:`, err);
  });
  child.on('exit', (code, signal) => {
    if (code !== null)
      console.log(`[Federation Setup] ${name} exited with code ${code}`);
    else if (signal !== null)
      console.log(
        `[Federation Setup] ${name} terminated with signal ${signal}`,
      );
  });
  return { name, child };
};

const run = async (cwd: string, cmd: string, args: string[]) => {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: workerEnv });
  await new Promise<void>((resolveRun, rejectRun) => {
    child.once('exit', (code) => {
      code === 0
        ? resolveRun()
        : rejectRun(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    child.once('error', (err) => rejectRun(err));
  });
};

declare global {
  // eslint-disable-next-line no-var
  var __RSTEST_MF_CHILDREN__: TrackedChild[] | undefined;
}

export const cleanupNodeRemote = async () => {
  try {
    rmSync(lockFile, { force: true });
  } catch {}
  const inUse = await isPortInUse(3001);
  if (inUse) {
    await killPort(3001).catch(() => {});
    console.log('[Federation Setup] Killed process on port 3001');
  }
  for (const { child } of globalThis.__RSTEST_MF_CHILDREN__ ?? []) {
    try {
      child.kill('SIGTERM');
    } catch {}
  }
  globalThis.__RSTEST_MF_CHILDREN__ = [];
};

export const ensureNodeRemote = async () => {
  globalThis.__RSTEST_MF_CHILDREN__ ??= [];

  // Kill port 3001 if it's already in use before starting the server
  const inUse = await isPortInUse(3001);
  if (inUse) {
    await killPort(3001).catch(() => {});
    console.log('[Federation Setup] Killed existing process on port 3001');
  }

  // In federation mode, the host is built for Node execution (async-node) even if tests
  // run under JSDOM. Serve the *node* remoteEntry on 3001 so the MF node loader can
  // evaluate it via fetch + vm and obtain the container interface (get/init).
  await run(componentAppDir, 'pnpm', ['build:node']);
  const server = start('component-app(node)', componentAppDir, 'pnpm', [
    'serve:node',
  ]);
  globalThis.__RSTEST_MF_CHILDREN__!.push(server);
  await waitForUrl(remoteEntryUrl, 30_000);

  // Also build node-local-remote for path-based consumption.
  const nodeLocalDir = resolve(workspaceRoot, 'node-local-remote');
  await run(nodeLocalDir, 'pnpm', ['build:node']);
};
