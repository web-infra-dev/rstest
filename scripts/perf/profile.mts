import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

type EnsureBuild = 'always' | 'if-missing' | 'never';
type ProfileKind = 'cpu' | 'heap';
type ProfileRole = 'main' | 'worker' | 'unknown';
type Category = 'rstest' | 'target' | 'node' | 'other';

interface CliOptions {
  target?: string;
  outputDir?: string;
  ensureBuild: EnsureBuild;
  buildFilters: string[];
  workers?: number;
  profile: ProfileKind;
  flame: boolean;
  label?: string;
  help: boolean;
  rstestArgs: string[];
}

interface FrameLocation {
  path: string;
  line?: number;
  column?: number;
}

interface FrameStat {
  key: string;
  functionName: string;
  generated: FrameLocation;
  original?: FrameLocation;
  category: Category;
  selfMs: number;
  totalMs: number;
  sampleCount: number;
}

interface FileStat {
  path: string;
  category: Category;
  selfMs: number;
  totalMs: number;
  sampleCount: number;
}

interface ProfileSummary {
  file: string;
  role: ProfileRole;
  durationMs: number;
  samples: number;
  allFrames: FrameStat[];
  allFiles: FileStat[];
  topSelfFrames: FrameStat[];
  topTotalFrames: FrameStat[];
  topFiles: FileStat[];
}

interface RunSummary {
  version: 1;
  run: {
    id: string;
    label: string;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    exitCode: number;
    success: boolean;
  };
  target: {
    requested?: string;
    path: string;
  };
  command: {
    cwd: string;
    argv: string[];
    buildFilters: string[];
    ensureBuild: EnsureBuild;
    profile: ProfileKind;
  };
  artifacts: {
    runDir: string;
    stdoutLog: string;
    stderrLog: string;
    buildLog: string;
    diagnosticDir: string;
    summaryJson: string;
    summaryMarkdown: string;
    rawProfiles: string[];
    flamegraphCommand?: string;
  };
  profiles: ProfileSummary[];
  aggregate: {
    topRstestFrames: FrameStat[];
    topRstestFiles: FileStat[];
    topTargetFrames: FrameStat[];
    topOverallFrames: FrameStat[];
    topOverallFiles: FileStat[];
  };
}

interface CpuProfileNode {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  children?: number[];
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
  startTime?: number;
  endTime?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../');
const defaultRunRoot = path.join(repoRoot, 'test-results', 'rstest-perf');

const syntheticFrameNames = new Set([
  '(anonymous)',
  '(program)',
  '(idle)',
  '(garbage collector)',
  '(root)',
]);

const printHelp = () => {
  process.stdout.write(
    `Usage: pnpm perf:rstest -- [target-dir] [options] -- [rstest args]\n\nOptions:\n  --target <path>          Target project directory to profile\n  --workers <count>        Force --pool.maxWorkers to a fixed value\n  --profile <cpu|heap>     Profiling mode (default: cpu)\n  --flame                  Open the first generated .cpuprofile in speedscope\n  --ensure-build <mode>    always | if-missing | never (default: always)\n  --build-filter <name>    Workspace package to rebuild before profiling\n  --output-dir <path>      Output directory (default: test-results/rstest-perf/<run-id>)\n  --label <name>           Optional run label\n  --help                   Show this help\n\nExamples:\n  pnpm perf:rstest -- './examples/node' --workers 1 --flame\n  pnpm perf:rstest -- --target '/tmp/user-repo' --ensure-build always -- run tests/unit/example.test.ts\n`,
  );
};

const log = (message: string) => {
  process.stderr.write(`${message}\n`);
};

const asError = (error: unknown): Error => {
  return error instanceof Error ? error : new Error(String(error));
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const normalizePath = (value: string): string => {
  if (value.startsWith('file://')) {
    return fileURLToPath(value);
  }

  return value;
};

const toPosixPath = (value: string): string => value.split(path.sep).join('/');

const createRunId = (label?: string): string => {
  const date = new Date();
  const timestamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '-',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
  ].join('');
  const slug = (label || 'run')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug ? `${timestamp}-${slug}` : timestamp;
};

const parseArgs = (argv: string[]): CliOptions => {
  const normalizedArgv = argv[0] === '--' ? argv.slice(1) : argv;
  const options: CliOptions = {
    ensureBuild: 'always',
    buildFilters: ['@rstest/core'],
    profile: 'cpu',
    flame: false,
    help: false,
    rstestArgs: [],
  };

  for (let index = 0; index < normalizedArgv.length; index += 1) {
    const arg = normalizedArgv[index];

    if (!arg) {
      continue;
    }

    const nextValue = normalizedArgv[index + 1];
    const requireValue = (flagName: string): string => {
      if (!nextValue) {
        throw new Error(`Missing value for ${flagName}`);
      }

      return nextValue;
    };

    if (arg === '--') {
      options.rstestArgs.push(...normalizedArgv.slice(index + 1));
      break;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--target') {
      options.target = requireValue('--target');
      index += 1;
      continue;
    }

    if (arg === '--flame') {
      options.flame = true;
      continue;
    }

    if (arg === '--output-dir') {
      options.outputDir = requireValue('--output-dir');
      index += 1;
      continue;
    }

    if (arg === '--ensure-build') {
      const value = requireValue('--ensure-build') as EnsureBuild;
      if (!value || !['always', 'if-missing', 'never'].includes(value)) {
        throw new Error(
          `Invalid --ensure-build value: ${value ?? '<missing>'}`,
        );
      }
      options.ensureBuild = value;
      index += 1;
      continue;
    }

    if (arg === '--build-filter') {
      options.buildFilters.push(requireValue('--build-filter'));
      index += 1;
      continue;
    }

    if (arg === '--workers') {
      const rawValue = requireValue('--workers');
      const value = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(value) || value < 1) {
        throw new Error(`Invalid --workers value: ${rawValue}`);
      }
      options.workers = value;
      index += 1;
      continue;
    }

    if (arg === '--profile') {
      const value = requireValue('--profile') as ProfileKind;
      if (!value || !['cpu', 'heap'].includes(value)) {
        throw new Error(`Invalid --profile value: ${value ?? '<missing>'}`);
      }
      options.profile = value;
      index += 1;
      continue;
    }

    if (arg === '--label') {
      options.label = requireValue('--label');
      index += 1;
      continue;
    }

    if (!arg.startsWith('-') && !options.target) {
      options.target = arg;
      continue;
    }

    options.rstestArgs.push(arg);
  }

  if (options.buildFilters.length > 1) {
    options.buildFilters = Array.from(new Set(options.buildFilters));
  }

  return options;
};

const resolveRequestedTarget = async (
  options: CliOptions,
): Promise<{ targetPath: string }> => {
  const absoluteTarget = options.target
    ? path.resolve(process.cwd(), options.target)
    : process.cwd();

  if (!(await pathExists(absoluteTarget))) {
    throw new Error(`Target path does not exist: ${absoluteTarget}`);
  }

  return { targetPath: absoluteTarget };
};

const createWriteStream = async (filePath: string) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'a' });
};

const appendHeader = async (filePath: string, header: string) => {
  await fsp.appendFile(filePath, `\n### ${header}\n`);
};

const runCommand = async (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdoutLogFile: string;
    stderrLogFile: string;
    streamPrefix: string;
  },
): Promise<number> => {
  await appendHeader(
    options.stdoutLogFile,
    `${options.streamPrefix}: ${[command, ...args].join(' ')}`,
  );
  await appendHeader(
    options.stderrLogFile,
    `${options.streamPrefix}: ${[command, ...args].join(' ')}`,
  );

  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdoutStream = await createWriteStream(options.stdoutLogFile);
  const stderrStream = await createWriteStream(options.stderrLogFile);

  const forwardStdout = (chunk: Buffer) => {
    stdoutStream.write(chunk);
    process.stderr.write(chunk);
  };

  const forwardStderr = (chunk: Buffer) => {
    stderrStream.write(chunk);
    process.stderr.write(chunk);
  };

  child.stdout.on('data', forwardStdout);
  child.stderr.on('data', forwardStderr);

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });

  await new Promise<void>((resolve) => {
    let pending = 2;
    const finish = () => {
      pending -= 1;
      if (pending === 0) {
        resolve();
      }
    };
    stdoutStream.end(finish);
    stderrStream.end(finish);
  });

  return exitCode;
};

const getBuildArtifacts = (filter: string): string[] => {
  if (filter === '@rstest/core') {
    return [path.join(repoRoot, 'packages', 'core', 'dist', 'index.js')];
  }

  if (filter === '@rstest/browser') {
    return [path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')];
  }

  return [];
};

const ensureBuild = async (
  filters: string[],
  mode: EnsureBuild,
  buildLog: string,
): Promise<void> => {
  if (mode === 'never') {
    return;
  }

  if (mode === 'if-missing') {
    const artifacts = filters.flatMap(getBuildArtifacts);
    if (artifacts.length > 0) {
      const missing = await Promise.all(
        artifacts.map((item) => pathExists(item)),
      );
      if (missing.every(Boolean)) {
        log('Skipping rebuild because expected artifacts already exist.');
        return;
      }
    }
  }

  for (const filter of filters) {
    log(`Building ${filter} with source maps enabled...`);
    const exitCode = await runCommand('pnpm', ['--filter', filter, 'build'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        SOURCEMAP: 'true',
      },
      stdoutLogFile: buildLog,
      stderrLogFile: buildLog,
      streamPrefix: `build ${filter}`,
    });

    if (exitCode !== 0) {
      throw new Error(`Failed to build ${filter} before profiling.`);
    }
  }
};

const hasArg = (argv: string[], name: string): boolean => {
  return argv.some((item) => item === name || item.startsWith(`${name}=`));
};

const buildRstestArgs = (options: CliOptions): string[] => {
  const baseArgs =
    options.rstestArgs.length > 0 ? [...options.rstestArgs] : ['run'];

  if (options.workers && !hasArg(baseArgs, '--pool.maxWorkers')) {
    baseArgs.push('--pool.maxWorkers', String(options.workers));
  }

  return baseArgs;
};

const openFlamegraph = async (profilePath: string): Promise<number> => {
  const child = spawn('npx', ['--yes', 'speedscope', profilePath], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  return new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
};

const roundNumber = (value: number): number => {
  return Number(value.toFixed(3));
};

const getCategory = (
  candidatePath: string | undefined,
  targetPath: string,
): Category => {
  if (!candidatePath) {
    return 'other';
  }

  const normalized = normalizePath(candidatePath);

  if (
    normalized.startsWith('node:') ||
    normalized.includes('/node:internal/')
  ) {
    return 'node';
  }

  if (path.isAbsolute(normalized) && normalized.startsWith(targetPath)) {
    return 'target';
  }

  if (
    path.isAbsolute(normalized) &&
    (normalized.startsWith(path.join(repoRoot, 'packages') + path.sep) ||
      normalized ===
        path.join(repoRoot, 'packages', 'core', 'bin', 'rstest.js'))
  ) {
    return 'rstest';
  }

  return 'other';
};

const resolveOriginalLocation = async (
  _generatedPath: string,
  _lineNumber?: number,
  _columnNumber?: number,
): Promise<FrameLocation | undefined> => {
  return undefined;
};

const frameKeyFromLocation = (
  functionName: string,
  generated: FrameLocation,
  original?: FrameLocation,
): string => {
  const active = original ?? generated;
  const line = active.line ? `:${active.line}` : '';
  const column = active.column ? `:${active.column}` : '';
  return `${functionName || '<anonymous>'} @ ${toPosixPath(active.path)}${line}${column}`;
};

const guessProfileRole = (frames: FrameStat[]): ProfileRole => {
  const joined = frames
    .slice(0, 20)
    .map(
      (item) =>
        `${item.functionName} ${item.original?.path ?? item.generated.path}`,
    )
    .join('\n');

  if (
    joined.includes('/runtime/worker/') ||
    joined.includes('globalSetupWorker')
  ) {
    return 'worker';
  }

  if (
    joined.includes('/src/cli/') ||
    joined.includes('runCLI') ||
    joined.includes('/bin/rstest.js')
  ) {
    return 'main';
  }

  return 'unknown';
};

const aggregateMaps = <
  T extends { selfMs: number; totalMs: number; sampleCount: number },
>(
  map: Map<string, T>,
  items: Iterable<T & { key?: string; path?: string }>,
  create: (item: T & { key?: string; path?: string }) => T,
  keySelector: (item: T & { key?: string; path?: string }) => string,
) => {
  for (const item of items) {
    const key = keySelector(item);
    const existing = map.get(key);
    if (existing) {
      existing.selfMs += item.selfMs;
      existing.totalMs += item.totalMs;
      existing.sampleCount += item.sampleCount;
    } else {
      map.set(key, create(item));
    }
  }
};

const sortFrameStats = (
  items: Iterable<FrameStat>,
  field: 'selfMs' | 'totalMs',
  limit = 15,
): FrameStat[] => {
  return [...items]
    .filter((item) => !syntheticFrameNames.has(item.functionName))
    .sort((left, right) => right[field] - left[field])
    .slice(0, limit)
    .map((item) => ({
      ...item,
      selfMs: roundNumber(item.selfMs),
      totalMs: roundNumber(item.totalMs),
    }));
};

const sortFileStats = (items: Iterable<FileStat>, limit = 15): FileStat[] => {
  return [...items]
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, limit)
    .map((item) => ({
      ...item,
      selfMs: roundNumber(item.selfMs),
      totalMs: roundNumber(item.totalMs),
    }));
};

const analyzeCpuProfile = async (
  filePath: string,
  targetPath: string,
): Promise<ProfileSummary> => {
  const raw = await fsp.readFile(filePath, 'utf8');
  const profile = JSON.parse(raw) as CpuProfile;
  const nodes = new Map<number, CpuProfileNode>();
  const parents = new Map<number, number>();

  for (const node of profile.nodes) {
    nodes.set(node.id, node);
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }

  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];
  const frameStats = new Map<string, FrameStat>();
  const fileStats = new Map<string, FileStat>();
  const ancestorCache = new Map<number, number[]>();

  const resolveAncestors = (nodeId: number): number[] => {
    const cached = ancestorCache.get(nodeId);
    if (cached) {
      return cached;
    }

    const chain: number[] = [];
    let current: number | undefined = nodeId;
    while (current !== undefined) {
      chain.push(current);
      current = parents.get(current);
    }
    ancestorCache.set(nodeId, chain);
    return chain;
  };

  const getOrCreateFrame = async (
    nodeId: number,
  ): Promise<FrameStat | undefined> => {
    const node = nodes.get(nodeId);
    if (!node) {
      return undefined;
    }

    const generatedPath = normalizePath(node.callFrame.url || '<unknown>');
    const generated: FrameLocation = {
      path: generatedPath,
      line:
        node.callFrame.lineNumber !== undefined
          ? node.callFrame.lineNumber + 1
          : undefined,
      column:
        node.callFrame.columnNumber !== undefined
          ? node.callFrame.columnNumber + 1
          : undefined,
    };
    const original = await resolveOriginalLocation(
      generatedPath,
      node.callFrame.lineNumber,
      node.callFrame.columnNumber,
    );
    const category = getCategory(original?.path ?? generated.path, targetPath);
    const key = frameKeyFromLocation(
      node.callFrame.functionName,
      generated,
      original,
    );
    const existing = frameStats.get(key);
    if (existing) {
      return existing;
    }

    const created: FrameStat = {
      key,
      functionName: node.callFrame.functionName || '<anonymous>',
      generated,
      original,
      category,
      selfMs: 0,
      totalMs: 0,
      sampleCount: 0,
    };
    frameStats.set(key, created);
    return created;
  };

  for (let index = 0; index < samples.length; index += 1) {
    const sampleNodeId = samples[index];
    if (sampleNodeId === undefined) {
      continue;
    }
    const deltaMs = (timeDeltas[index] ?? 0) / 1000;
    const ancestors = resolveAncestors(sampleNodeId);

    for (
      let ancestorIndex = 0;
      ancestorIndex < ancestors.length;
      ancestorIndex += 1
    ) {
      const ancestorId = ancestors[ancestorIndex];
      if (ancestorId === undefined) {
        continue;
      }
      const frame = await getOrCreateFrame(ancestorId);
      if (!frame) {
        continue;
      }

      frame.totalMs += deltaMs;
      if (ancestorIndex === 0) {
        frame.selfMs += deltaMs;
      }
      frame.sampleCount += 1;

      const filePathKey = frame.original?.path ?? frame.generated.path;
      const existingFile = fileStats.get(filePathKey);
      if (existingFile) {
        existingFile.totalMs += deltaMs;
        if (ancestorIndex === 0) {
          existingFile.selfMs += deltaMs;
        }
        existingFile.sampleCount += 1;
      } else {
        fileStats.set(filePathKey, {
          path: filePathKey,
          category: frame.category,
          selfMs: ancestorIndex === 0 ? deltaMs : 0,
          totalMs: deltaMs,
          sampleCount: 1,
        });
      }
    }
  }

  const durationMs = profile.timeDeltas?.length
    ? profile.timeDeltas.reduce((sum, item) => sum + item, 0) / 1000
    : ((profile.endTime ?? 0) - (profile.startTime ?? 0)) / 1000;
  const allFrames = [...frameStats.values()];

  return {
    file: filePath,
    role: guessProfileRole(sortFrameStats(allFrames, 'totalMs', 20)),
    durationMs: roundNumber(durationMs),
    samples: samples.length,
    allFrames: allFrames.map((item) => ({
      ...item,
      selfMs: roundNumber(item.selfMs),
      totalMs: roundNumber(item.totalMs),
    })),
    allFiles: [...fileStats.values()].map((item) => ({
      ...item,
      selfMs: roundNumber(item.selfMs),
      totalMs: roundNumber(item.totalMs),
    })),
    topSelfFrames: sortFrameStats(allFrames, 'selfMs'),
    topTotalFrames: sortFrameStats(allFrames, 'totalMs'),
    topFiles: sortFileStats(fileStats.values()),
  };
};

const pad = (value: string, width: number): string => {
  const raw =
    value.length > width ? `${value.slice(0, Math.max(width - 1, 1))}~` : value;
  return raw.padEnd(width, ' ');
};

const renderTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((header, index) => {
    const rowWidths = rows.map((row) => (row[index] ?? '').length);
    return Math.min(90, Math.max(header.length, ...rowWidths));
  });
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const renderRow = (row: string[]) => {
    return `| ${row.map((cell, index) => pad(cell ?? '', widths[index] ?? 0)).join(' | ')} |`;
  };

  return [
    border,
    renderRow(headers),
    border,
    ...rows.map(renderRow),
    border,
  ].join('\n');
};

const displayLocation = (frame: FrameStat): string => {
  const location = frame.original ?? frame.generated;
  const line = location.line ? `:${location.line}` : '';
  return `${toPosixPath(location.path)}${line}`;
};

const renderMarkdownSummary = (summary: RunSummary): string => {
  const runTable = renderTable(
    ['Field', 'Value'],
    [
      ['runId', summary.run.id],
      ['target', toPosixPath(summary.target.path)],
      ['success', String(summary.run.success)],
      ['exitCode', String(summary.run.exitCode)],
      ['durationMs', String(summary.run.durationMs)],
      ['profile', summary.command.profile],
      ['rawProfiles', String(summary.artifacts.rawProfiles.length)],
    ],
  );
  const profileTable = renderTable(
    ['Profile', 'Role', 'Duration(ms)', 'Samples'],
    summary.profiles.map((item) => [
      path.basename(item.file),
      item.role,
      String(item.durationMs),
      String(item.samples),
    ]),
  );

  const topFrameRows = summary.aggregate.topRstestFrames.map((item) => [
    item.functionName,
    String(item.totalMs),
    String(item.selfMs),
    displayLocation(item),
  ]);
  const topFileRows = summary.aggregate.topRstestFiles.map((item) => [
    toPosixPath(item.path),
    String(item.totalMs),
    String(item.selfMs),
    item.category,
  ]);

  return [
    '# Rstest perf profile',
    '',
    '## Run',
    '',
    '```plaintext',
    runTable,
    '```',
    '',
    '## Profiles',
    '',
    '```plaintext',
    profileTable,
    '```',
    '',
    '## Top rstest frames',
    '',
    '```plaintext',
    renderTable(
      ['Function', 'Total(ms)', 'Self(ms)', 'Location'],
      topFrameRows,
    ),
    '```',
    '',
    '## Top rstest files',
    '',
    '```plaintext',
    renderTable(['File', 'Total(ms)', 'Self(ms)', 'Category'], topFileRows),
    '```',
    '',
    '## Artifacts',
    '',
    `- Summary JSON: \`${toPosixPath(summary.artifacts.summaryJson)}\``,
    `- Summary Markdown: \`${toPosixPath(summary.artifacts.summaryMarkdown)}\``,
    `- Diagnostic directory: \`${toPosixPath(summary.artifacts.diagnosticDir)}\``,
    `- Stdout log: \`${toPosixPath(summary.artifacts.stdoutLog)}\``,
    `- Stderr log: \`${toPosixPath(summary.artifacts.stderrLog)}\``,
    '',
    '## Flame graph',
    '',
    summary.artifacts.flamegraphCommand ? '```bash' : '',
    ...(summary.artifacts.flamegraphCommand
      ? [summary.artifacts.flamegraphCommand]
      : []),
    summary.artifacts.flamegraphCommand ? '```' : '',
    '',
    'You can also open any generated `.cpuprofile` file in Chrome DevTools or VS Code for a graphical flame chart.',
    '',
  ].join('\n');
};

const writeJson = async (filePath: string, value: unknown) => {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const startedAt = new Date();
  const { targetPath } = await resolveRequestedTarget(options);
  const label = options.label ?? path.basename(targetPath);
  const runId = createRunId(label);
  const runDir = options.outputDir
    ? path.resolve(process.cwd(), options.outputDir)
    : path.join(defaultRunRoot, runId);

  await fsp.mkdir(runDir, { recursive: true });

  const buildLog = path.join(runDir, 'build.log');
  const stdoutLog = path.join(runDir, 'stdout.log');
  const stderrLog = path.join(runDir, 'stderr.log');
  const diagnosticDir = path.join(runDir, 'diagnostic');
  const summaryJson = path.join(runDir, 'summary.json');
  const summaryMarkdown = path.join(runDir, 'summary.md');

  await fsp.mkdir(diagnosticDir, { recursive: true });
  await fsp.writeFile(buildLog, '');
  await fsp.writeFile(stdoutLog, '');
  await fsp.writeFile(stderrLog, '');

  await ensureBuild(options.buildFilters, options.ensureBuild, buildLog);

  const rstestArgs = buildRstestArgs(options);
  const nodeArgs =
    options.profile === 'heap'
      ? ['--heap-prof', `--heap-prof-dir=${diagnosticDir}`]
      : ['--cpu-prof', `--diagnostic-dir=${diagnosticDir}`];
  const argv = [
    ...nodeArgs,
    path.join(repoRoot, 'packages', 'core', 'bin', 'rstest.js'),
    ...rstestArgs,
  ];

  log(`Profiling target ${targetPath}`);
  const exitCode = await runCommand('node', argv, {
    cwd: targetPath,
    stdoutLogFile: stdoutLog,
    stderrLogFile: stderrLog,
    streamPrefix: 'rstest stdout/stderr',
    env: process.env,
  });

  const allArtifacts = await fsp.readdir(diagnosticDir);
  const rawProfiles = allArtifacts
    .filter((item) =>
      item.endsWith(
        options.profile === 'heap' ? '.heapprofile' : '.cpuprofile',
      ),
    )
    .map((item) => path.join(diagnosticDir, item))
    .sort();
  const flamegraphCommand = rawProfiles[0]
    ? `npx --yes speedscope '${toPosixPath(rawProfiles[0])}'`
    : undefined;

  const profiles =
    options.profile === 'cpu'
      ? await Promise.all(
          rawProfiles.map((item) => analyzeCpuProfile(item, targetPath)),
        )
      : [];

  const frameAggregate = new Map<string, FrameStat>();
  const fileAggregate = new Map<string, FileStat>();

  for (const profile of profiles) {
    aggregateMaps(
      frameAggregate,
      profile.allFrames,
      (item) => ({ ...item }),
      (item) => item.key ?? '',
    );
    aggregateMaps(
      fileAggregate,
      profile.allFiles,
      (item) => ({ ...item }),
      (item) => item.path ?? '',
    );
  }

  const allFrames = [...frameAggregate.values()];
  const allFiles = [...fileAggregate.values()];
  const finishedAt = new Date();

  const summary: RunSummary = {
    version: 1,
    run: {
      id: runId,
      label,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      exitCode,
      success: exitCode === 0,
    },
    target: {
      requested: options.target,
      path: targetPath,
    },
    command: {
      cwd: targetPath,
      argv,
      buildFilters: options.buildFilters,
      ensureBuild: options.ensureBuild,
      profile: options.profile,
    },
    artifacts: {
      runDir,
      stdoutLog,
      stderrLog,
      buildLog,
      diagnosticDir,
      summaryJson,
      summaryMarkdown,
      rawProfiles,
      flamegraphCommand,
    },
    profiles,
    aggregate: {
      topRstestFrames: sortFrameStats(
        allFrames.filter((item) => item.category === 'rstest'),
        'totalMs',
      ),
      topRstestFiles: sortFileStats(
        allFiles.filter((item) => item.category === 'rstest'),
      ),
      topTargetFrames: sortFrameStats(
        allFrames.filter((item) => item.category === 'target'),
        'totalMs',
      ),
      topOverallFrames: sortFrameStats(allFrames, 'totalMs'),
      topOverallFiles: sortFileStats(allFiles),
    },
  };

  await writeJson(summaryJson, summary);
  await fsp.writeFile(summaryMarkdown, renderMarkdownSummary(summary));

  if (options.flame && rawProfiles[0]) {
    const flameExitCode = await openFlamegraph(rawProfiles[0]);
    if (flameExitCode !== 0 && exitCode === 0) {
      process.exitCode = flameExitCode;
    }
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runDir,
        summaryJson,
        summaryMarkdown,
        success: summary.run.success,
        exitCode,
        rawProfiles,
      },
      null,
      2,
    )}\n`,
  );

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

main().catch((error) => {
  const normalizedError = asError(error);
  process.stderr.write(`${normalizedError.stack ?? normalizedError.message}\n`);
  process.exitCode = 1;
});
