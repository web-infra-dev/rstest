import fs from 'node:fs';
import path from 'node:path';
import type {
  onTestFailed as onRstestFailed,
  onTestFinished as onRstestFinished,
} from '@rstest/core';
import stripAnsi from 'strip-ansi';
import type { Options, Result } from 'tinyexec';
import { x } from 'tinyexec';
import treeKill from 'tree-kill';

type IoType = 'stdout' | 'stderr';
class Cli {
  public exec: Result;
  public stdout = '';
  public stderr = '';
  public log = '';
  private stdoutListeners: Array<() => void> = [];
  private stderrListeners: Array<() => void> = [];
  private stdoutEnded: Promise<void>;
  private stderrEnded: Promise<void>;

  constructor(
    exec: Result,
    options?: {
      stripAnsi?: boolean;
    },
  ) {
    this.exec = exec;
    const strip = options?.stripAnsi ?? true;

    this.stdoutEnded = new Promise((resolve) => {
      if (!this.exec.process?.stdout) {
        resolve();
        return;
      }
      this.exec.process.stdout.once('end', resolve);
      this.exec.process.stdout.once('error', resolve);
    });

    this.stderrEnded = new Promise((resolve) => {
      if (!this.exec.process?.stderr) {
        resolve();
        return;
      }
      this.exec.process.stderr.once('end', resolve);
      this.exec.process.stderr.once('error', resolve);
    });

    this.exec.process?.stdout?.on('data', (data) => {
      const processStd = strip ? stripAnsi(data.toString()) : data.toString();
      this.stdout += processStd ?? '';
      this.log += processStd ?? '';
      for (const listener of this.stdoutListeners) {
        listener();
      }
    });

    this.exec.process?.stderr?.on('data', (data) => {
      const processStd = strip ? stripAnsi(data.toString()) : data.toString();
      this.stderr += processStd ?? '';
      this.log += processStd ?? '';
      for (const listener of this.stderrListeners) {
        listener();
      }
    });

    const execKill = this.exec.kill.bind(this.exec);

    this.exec.kill = () => {
      // Ensure we kill the entire process tree (important on Windows where child
      // processes may survive and keep the test worker alive).
      const pid = this.exec.process?.pid;
      if (pid) {
        treeKill(pid, 'SIGKILL');
        return true;
      }

      return execKill();
    };
  }

  /**
   * Wait for stdout and stderr streams to end.
   * This ensures all output data has been received after the process exits.
   */
  waitForStreamsEnd() {
    return Promise.all([this.stdoutEnded, this.stderrEnded]);
  }

  resetStd = (std?: IoType) => {
    const toReset: IoType[] = std ? [std] : ['stdout', 'stderr'];
    for (const io of toReset) {
      this[io] = '';
    }
    this.log = '';
  };

  private waitForStd = (expect: string | RegExp, io: IoType): Promise<void> => {
    return new Promise((resolve) => {
      this[`${io}Listeners`].push(() => {
        if (typeof expect === 'string') {
          if (this[io].includes(expect)) {
            resolve(undefined);
          }
        } else {
          if (this[io].match(expect)) {
            resolve(undefined);
          }
        }
      });
    });
  };

  waitForStdout(expect: string | RegExp) {
    return this.waitForStd(expect, 'stdout');
  }

  waitForStderr(expect: string | RegExp) {
    return this.waitForStd(expect, 'stderr');
  }
}

export async function runRstestCli({
  command,
  options,
  args = [],
  stripAnsi,
  onTestFinished,
  onTestFailed,
  unsetEnv,
}: {
  command: string;
  options?: Partial<Options>;
  args?: string[];
  stripAnsi?: boolean;
  onTestFinished?: typeof onRstestFinished;
  onTestFailed?: typeof onRstestFailed;
  unsetEnv?: string[];
}) {
  // fix get accurate test when no-isolate
  const {
    onTestFinished: onRstestFinished,
    onTestFailed: onRstestFailed,
    expect,
  } = await import('@rstest/core');

  if (process.env.ISOLATE === 'false' && !args.includes('--isolate')) {
    args.push('--isolate', 'false');
  }

  const baseEnv: Record<string, string | undefined> = { ...process.env };
  for (const key of unsetEnv ?? []) {
    // tinyexec merges env as `{ ...process.env, ...options.env }`, so deleting the
    // key here is not enough if the parent process has it set (e.g. FORCE_COLOR).
    // Setting it to `undefined` ensures it is treated as unset in the spawned process.
    baseEnv[key] = undefined;
  }

  const exec = x(command, args, {
    ...options,
    nodeOptions: {
      ...(options?.nodeOptions || {}),
      env: {
        ...baseEnv,
        ...(options?.nodeOptions?.env || {}),
      },
    },
  } as Options);

  const cli = new Cli(exec, { stripAnsi });

  (onTestFinished || onRstestFinished)(() => {
    !cli.exec.killed && cli.exec.kill();
  });

  (onTestFailed || onRstestFailed)?.(({ task }) => {
    if (task.result?.errors?.[0]) {
      task.result.errors![0]!.message +=
        `\n\n--- CLI Log Start ---\n${cli.log}\n--- CLI Log End ---\n`;
    }
  });

  const expectExecSuccess = async () => {
    await cli.exec;
    await cli.waitForStreamsEnd();
    const exitCode = cli.exec.process?.exitCode;
    if (exitCode !== 0) {
      const logs = cli.stdout.split('\n').filter(Boolean);
      throw new Error(
        `Test failed with exit code ${exitCode}. Logs:\n\n${logs.join('\n')}`,
      );
    }
    expect(exitCode).toBe(0);
  };

  const expectExecFailed = async () => {
    await cli.exec;
    await cli.waitForStreamsEnd();
    const exitCode = cli.exec.process?.exitCode;
    if (exitCode === 0) {
      const logs = cli.stdout.split('\n').filter(Boolean);
      throw new Error(
        `expect test failed but passed. Logs:\n\n${logs.join('\n')}`,
      );
    }
    expect(exitCode).not.toBe(0);
  };

  const expectLog = (
    msg: string | RegExp,
    logs: string[] = cli.stdout.split('\n').filter(Boolean),
  ) => {
    const matchedLog = logs.find((log) => {
      if (typeof msg === 'string') {
        return log.includes(msg);
      }
      return log.match(msg);
    });

    if (!matchedLog) {
      throw new Error(`Can't find log(${msg}) in:\n${logs.join('\n')}`);
    }
  };

  const expectStderrLog = (
    msg: string | RegExp,
    logs: string[] = cli.stderr.split('\n').filter(Boolean),
  ) => {
    expectLog(msg, logs);
  };

  return {
    cli,
    expectExecSuccess,
    expectExecFailed,
    expectLog,
    expectStderrLog,
  };
}

export async function prepareFixtures({
  fixturesPath,
  fixturesTargetPath,
}: {
  fixturesPath: string;
  fixturesTargetPath?: string;
}) {
  const root = path.dirname(fixturesPath);
  const distPath = fixturesTargetPath || path.resolve(`${fixturesPath}-test`);

  // Clean up any leftover fixtures from previous runs
  // On Windows, file handles may not be fully released, causing EBUSY errors
  // See: https://github.com/nodejs/node/issues/49985
  try {
    fs.rmSync(distPath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  } catch (err) {
    if (process.platform !== 'win32') {
      throw err;
    }
    // On Windows, if we can't delete, try to proceed anyway
    // The copy operation with force: true may still work
  }

  await fs.promises.mkdir(distPath, { recursive: true });
  await fs.promises.cp(fixturesPath, distPath, {
    recursive: true,
    force: true,
    // Exclude temp fixture directories created by other parallel tests
    // to avoid race conditions (e.g., ENOENT when a directory is deleted mid-copy)
    filter: (src) => !path.basename(src).startsWith('fixtures-test-'),
  });

  const update = (
    relativePath: string,
    content: string | ((raw: string) => string),
  ) => {
    const targetFilepath = path.resolve(root, relativePath);
    let newContent = content;
    if (typeof content === 'function') {
      const oldContent = fs.readFileSync(targetFilepath, 'utf-8');
      newContent = content(oldContent);
    } else {
      newContent = content;
    }

    fs.writeFileSync(targetFilepath, newContent, 'utf-8');
  };

  const remove = (filePath: string) => {
    const targetFilepath = path.resolve(root, filePath);
    // Use maxRetries and retryDelay to handle Windows file locking issues
    // where processes may not have fully released file handles yet
    fs.rmSync(targetFilepath, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 500,
    });
  };

  const create = (filePath: string, content: string) => {
    fs.writeFileSync(path.resolve(root, filePath), content, 'utf-8');
  };

  const read = (relativePath: string) => {
    const targetFilepath = path.resolve(root, relativePath);
    const content = fs.readFileSync(targetFilepath, 'utf-8');
    return content;
  };

  const rename = (oldPath: string, newPath: string) => {
    const oldAbsPath = path.resolve(root, oldPath);
    const newAbsPath = path.resolve(root, newPath);
    fs.renameSync(oldAbsPath, newAbsPath);
  };

  return {
    fs: {
      create,
      update,
      read,
      delete: remove,
      rename,
    },
  };
}

export * from './utils';
