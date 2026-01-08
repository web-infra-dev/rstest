// Build the node-local remote once before running tests.
//
// The test runner executes projects directly (it does not run `pnpm test` for each
// example package), so package.json `pretest` hooks won't run in CI.
// Without this step, Module Federation's Node runtime can't load the local remoteEntry.
import { spawn } from 'node:child_process';
import path from 'node:path';

const run = async (cwd: string, cmd: string, args: string[]) => {
  const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
  await new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
    child.once('error', (err) => reject(err));
  });
};

const getPnpmCmd = () => (process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');

export async function setup() {
  const federationRoot = path.resolve(__dirname, '..', '..');
  const nodeLocalDir = path.resolve(federationRoot, 'node-local-remote');
  await run(nodeLocalDir, getPnpmCmd(), ['build:node']);
}

export async function teardown() {
  // no-op
}
