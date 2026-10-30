import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { RstestPoolOptions } from '../../types';
import { getHostExecArgv } from '../../utils/workers';

export type RuntimeDependencyCall = {
  kind: 'import' | 'require' | 'resolve';
  origin: 'source' | 'entry';
  parts: (string | null)[] | null;
  unsupported?: string;
};

export type RuntimeDependencyMetadata = {
  version: number;
  calls: RuntimeDependencyCall[];
};

export type RuntimeDependencyRequest = {
  consumer: string;
  source: string;
  call: RuntimeDependencyCall;
};

type RuntimeDependencyResponse = {
  consumers: string[];
  unresolved: string[];
  contract: {
    patternSemantics:
      'complete-declarations-or-literals' | 'single-segment-potential-targets';
  };
  statistics: {
    candidates: number;
    reads: number;
    parses: number;
    resolutions: number;
    syntaxChecks: number;
  };
};

// NODE_OPTIONS uses Node's double-quote/escape grammar, not shell tokenization.
const parseNodeOptions = (value: string): string[] => {
  const arguments_: string[] = [];
  let quoted = false;
  let startsArgument = true;
  for (let index = 0; index < value.length; index++) {
    let character = value[index]!;
    if (character === '\\' && quoted) {
      if (++index === value.length) {
        throw new Error(
          'Invalid NODE_OPTIONS: trailing escape in quoted value.',
        );
      }
      character = value[index]!;
    } else if (character === ' ' && !quoted) {
      startsArgument = true;
      continue;
    } else if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (startsArgument) {
      arguments_.push(character);
      startsArgument = false;
    } else {
      arguments_[arguments_.length - 1] += character;
    }
  }
  if (quoted) {
    throw new Error('Invalid NODE_OPTIONS: unterminated quoted value.');
  }
  return arguments_;
};

export const resolveRuntimeDependencyConsumers = async ({
  requests,
  sources,
  pool,
  env,
}: {
  requests: RuntimeDependencyRequest[];
  sources: ReadonlySet<string>;
  pool: RstestPoolOptions;
  env: Record<string, string | undefined>;
}): Promise<Set<string>> => {
  if (requests.length === 0) {
    return new Set();
  }

  const execArgv = [
    ...getHostExecArgv(pool.type ?? 'forks', process.execArgv),
    ...(pool.execArgv ?? []),
    '--experimental-import-meta-resolve',
  ];
  const workerEnv = { ...process.env, ...env };
  const nodeArguments = [
    ...execArgv,
    ...parseNodeOptions(workerEnv.NODE_OPTIONS ?? ''),
  ];
  if (
    nodeArguments.some((argument) => {
      const name = argument.split('=', 1)[0]!.replaceAll('_', '-');
      return (
        /^--(?:import|require|loader|experimental-loader)$/.test(name) ||
        /^--(?:env-file(?:-if-exists)?|experimental-(?:default-)?config-file)$/.test(
          name,
        ) ||
        /^-r/.test(argument)
      );
    })
  ) {
    throw new Error(
      'Native dependency selection is incomplete with custom Node loading hooks or external Node option files. ' +
        'Use a full run or explicitly declare the runtime dependency files.',
    );
  }

  const output = await new Promise<string>((fulfill, reject) => {
    const child = spawn(
      process.execPath,
      [
        ...execArgv,
        fileURLToPath(
          new URL('./runtimeDependenciesWorker.mjs', import.meta.url),
        ),
      ],
      {
        env: workerEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        fulfill(stdout);
      } else {
        reject(
          new Error(
            `Native dependency analysis failed (${code}): ${stderr.trim()}`,
          ),
        );
      }
    });
    child.stdin.end(JSON.stringify({ requests, sources: [...sources] }));
  });

  // This private worker owns the matching response shape; it never runs user code.
  const result: RuntimeDependencyResponse = JSON.parse(output);
  if (result.unresolved.length > 0) {
    throw new Error(
      'Native dependency selection is incomplete:\n' +
        result.unresolved.map((reason) => `- ${reason}`).join('\n') +
        '\nUse a full run or explicitly declare the runtime dependency files.',
    );
  }
  return new Set(result.consumers);
};
