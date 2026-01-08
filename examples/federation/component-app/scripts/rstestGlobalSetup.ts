// Build the node-local remote once before running tests.
//
// The test runner executes projects directly (it does not run `pnpm test` for each
// example package), so package.json `pretest` hooks won't run in CI.
// Without this step, Module Federation's Node runtime can't load the local remoteEntry.
import { spawn } from 'node:child_process';
import path from 'node:path';

const run = async (cwd: string, cmd: string, args: string[]) => {
  // On Windows, pnpm is typically a `.cmd` shim, which isn't directly executable
  // via CreateProcess (spawn) unless run through a shell.
  const child = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    child.once('error', (err) => reject(err));
  });
};

export async function setup() {
  const federationRoot = path.resolve(__dirname, '..', '..');
  const nodeLocalDir = path.resolve(federationRoot, 'node-local-remote');
  await run(nodeLocalDir, 'pnpm', ['build:node']);
}

export async function teardown() {
  // no-op
}
