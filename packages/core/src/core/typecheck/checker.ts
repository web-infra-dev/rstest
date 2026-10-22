import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, normalize, resolve } from 'pathe';
import { readTsconfig } from 'get-tsconfig';
import type { InternalProjectContext, SerializedError } from '../../types';

export interface TypeDiagnostic {
  file?: string;
  line?: number;
  column?: number;
  error: SerializedError;
}

export function parseDiagnostics(
  output: string,
  cwd: string,
): {
  diagnostics: TypeDiagnostic[];
  unparsed: string[];
} {
  const diagnostics: TypeDiagnostic[] = [];
  const unparsed: string[] = [];
  let current: TypeDiagnostic | undefined;
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    const match = /^(?:(.+)\((\d+),(\d+)\):\s*)?error TS(\d+):\s*(.*)$/.exec(
      line,
    );
    if (match) {
      const file = match[1]
        ? normalize(isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1]))
        : undefined;
      current = {
        file,
        line: match[2] ? Number(match[2]) : undefined,
        column: match[3] ? Number(match[3]) : undefined,
        error: {
          name: `TS${match[4]}`,
          message: match[5]!,
          ...(file
            ? {
                stack: `TS${match[4]}: ${match[5]}\n    at ${file}:${match[2]}:${match[3]}`,
              }
            : {}),
        },
      };
      diagnostics.push(current);
    } else if (/^\s/.test(line) && current) {
      current.error.message += `\n${line}`;
    } else {
      current = undefined;
      unparsed.push(line);
    }
  }
  return { diagnostics, unparsed };
}

export function createTypeChecker(project: InternalProjectContext): {
  prepare(
    testPaths: string[],
  ): Promise<{ files: string[]; directories: string[] }>;
  check(): Promise<TypeDiagnostic[]>;
  close(): Promise<void>;
  readonly version: string;
} {
  const { root, typecheck } = project.normalizedConfig;
  const configPath = resolve(root, typecheck.tsconfig);
  const cacheFile = resolve(
    root,
    'node_modules/.cache/rstest/typecheck',
    `${createHash('sha256').update(`${configPath}:${typecheck.checker}`).digest('hex')}.tsbuildinfo`,
  );
  const require = createRequire(resolve(root, 'package.json'));
  let child: ChildProcess | undefined;
  let pending: Promise<unknown> | undefined;
  let closed = false;
  let noCheck = false;
  let compiler: string;
  let version: string;
  try {
    const packagePath = require.resolve(
      `${typecheck.checker === 'vue-tsc' ? 'vue-tsc' : 'typescript'}/package.json`,
    );
    const metadata: { version: string; bin: string | Record<string, string> } =
      JSON.parse(readFileSync(packagePath, 'utf8'));
    const bin =
      typeof metadata.bin === 'string'
        ? metadata.bin
        : metadata.bin[typecheck.checker];
    if (!bin)
      throw new Error(
        `Package does not expose the ${typecheck.checker} command.`,
      );
    compiler = resolve(dirname(packagePath), bin);
    version = metadata.version;
  } catch (cause) {
    throw new Error(
      `Type testing requires ${typecheck.checker === 'vue-tsc' ? 'vue-tsc' : 'typescript'} in project "${project.name}". Install it as a dev dependency.`,
      { cause },
    );
  }
  const run = async (args: string[]) => {
    if (closed) throw new Error('Type checker was interrupted.');
    const promise = new Promise<{ output: string; code: number | null }>(
      (done, reject) => {
        child = spawn(
          process.execPath,
          [compiler, '--project', configPath, '--pretty', 'false', ...args],
          {
            cwd: root,
            detached: process.platform !== 'win32',
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
          output += chunk;
        });
        child.stderr!.setEncoding('utf8').on('data', (chunk: string) => {
          output += chunk;
        });
        child.once('error', reject);
        child.once('close', (code, signal) => {
          child = undefined;
          if (signal || closed)
            reject(
              new Error(
                `Type checker interrupted${signal ? ` (${signal})` : ''}.`,
              ),
            );
          else done({ output, code });
        });
      },
    );
    pending = promise;
    return promise;
  };
  return {
    version,
    async prepare(testPaths: string[]) {
      const config = await run(['--showConfig']);
      if (config.code !== 0)
        throw new Error(
          `Cannot load type test config ${configPath}:\n${config.output}`,
        );
      const parsed: {
        files?: string[];
        compilerOptions?: { noCheck?: boolean };
      } = JSON.parse(config.output);
      noCheck = parsed.compilerOptions?.noCheck === true;
      if (!Array.isArray(parsed.files))
        throw new Error(
          `Type test config ${configPath} has no root files. Solution-style configs require a test tsconfig with files/include.`,
        );
      const roots = new Set(
        parsed.files.map((file) => resolve(dirname(configPath), file)),
      );
      const missing = testPaths.filter((file) => !roots.has(normalize(file)));
      if (missing.length)
        throw new Error(
          `Type test files are not included in ${configPath}:\n${missing.join('\n')}`,
        );
      const listing = await run(['--listFilesOnly']);
      if (listing.code !== 0)
        throw new Error(
          `Cannot resolve type test dependencies:\n${listing.output}`,
        );
      const dependencies = listing.output
        .split(/\r?\n/)
        .filter((file) => isAbsolute(file));
      const resolvedConfig = readTsconfig(configPath, {
        typescriptVersion: false,
      });
      const configDependencies = resolvedConfig.sources ?? [configPath];
      const metadata = new Set<string>();
      for (const file of [...dependencies, ...configDependencies]) {
        let directory = dirname(file);
        while (dirname(directory) !== directory) {
          metadata.add(resolve(directory, 'package.json'));
          if (directory === root) break;
          directory = dirname(directory);
        }
      }
      const directories = (resolvedConfig.config.include ?? []).map(
        (pattern) => {
          const prefix = pattern.split(/[?*{[]/, 1)[0]!;
          return resolve(
            dirname(configPath),
            prefix.endsWith('/') ? prefix : dirname(prefix),
          );
        },
      );
      return {
        files: [
          ...new Set([
            configPath,
            ...dependencies,
            ...configDependencies,
            ...metadata,
          ]),
        ],
        directories,
      };
    },
    async check() {
      await mkdir(dirname(cacheFile), { recursive: true });
      const { output, code } = await run([
        '--noEmit',
        ...(noCheck ? ['--noCheck', 'false'] : []),
        '--locale',
        'en',
        '--incremental',
        '--tsBuildInfoFile',
        cacheFile,
      ]);
      const { diagnostics, unparsed } = parseDiagnostics(output, root);
      if (unparsed.length || (code !== 0 && !diagnostics.length)) {
        throw new Error(
          `Type checker failed (exit ${code}):\n${output || 'No diagnostics were produced.'}`,
        );
      }
      return diagnostics;
    },
    async close() {
      closed = true;
      if (child?.pid) {
        if (process.platform === 'win32') {
          const killer = spawn(
            // cspell:ignore taskkill
            'taskkill',
            ['/pid', String(child.pid), '/t', '/f'],
            { stdio: 'ignore' },
          );
          await new Promise<void>((resolve, reject) => {
            killer.once('error', reject);
            killer.once('close', () => resolve());
          });
        } else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch (error) {
            if (!(
              error instanceof Error &&
              'code' in error &&
              error.code === 'ESRCH'
            ))
              throw error;
          }
        }
      }
      await pending?.catch(() => undefined);
    },
  };
}
