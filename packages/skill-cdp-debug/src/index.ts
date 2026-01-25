import { cac } from 'cac';
import {
  createOutputWriter,
  loadPlan,
  normalizeRunnerArgs,
  parseCliOptions,
  parseTaskFilter,
  spawnRunner,
  waitForInspectorUrl,
} from './plan';
import { createCdpClient, DebugSession } from './session';
import type { DebugResult } from './types';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

type ParsedArgs = {
  options: Record<string, unknown>;
  positional: string[];
  shouldExit: boolean;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const cli = cac('rstest-cdp-debug');

  cli.option('-p, --plan <path>', 'Path to plan JSON file (or "-" for stdin)');
  cli.option('--task <ids>', 'Comma-separated task ids to run');
  cli.option('--tasks <ids>', 'Alias for --task');
  cli.option('--expression <expr>', 'Expression to evaluate');
  cli.option('--expr <expr>', 'Alias for --expression');
  cli.option(
    '--output <path>',
    'Write JSON output to file (or "-" for stdout)',
  );
  cli.option('--debug', 'Enable debug logging');

  cli.help();
  cli.globalCommand.allowUnknownOptions();

  // Normalize `--plan -` and `--output -` so stdin/stdout markers survive parsing
  // (cac/mri may drop standalone `-` tokens)
  const normalizedArgv: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if ((token === '--plan' || token === '-p') && argv[i + 1] === '-') {
      normalizedArgv.push('--plan=-');
      i += 1;
      continue;
    }
    if (token === '--output' && argv[i + 1] === '-') {
      normalizedArgv.push('--output=-');
      i += 1;
      continue;
    }
    normalizedArgv.push(token);
  }

  const parsed = cli.parse(normalizedArgv, { run: false });

  if (parsed.options.help) {
    cli.outputHelp();
    return { options: {}, positional: [], shouldExit: true };
  }

  return {
    options: parsed.options as Record<string, unknown>,
    positional: Array.from(parsed.args),
    shouldExit: false,
  };
};

// ============================================================================
// Main Entry Point
// ============================================================================

export const runCli = async (): Promise<void> => {
  const parsedArgs = parseArgs(process.argv);
  if (parsedArgs.shouldExit) return;

  const options = parseCliOptions(parsedArgs.options);
  const output = createOutputWriter(options.outputPath);

  const debugLog = (...args: unknown[]) => {
    if (options.debug) {
      console.error('[rstest-cdp-debug]', ...args);
    }
  };

  /** Write failure result and clean up */
  const writeFailure = (
    error: string,
    runner: {
      cmd: string;
      args: string[];
      cwd: string;
      env?: Record<string, string>;
    } = {
      cmd: '',
      args: [],
      cwd: process.cwd(),
      env: {},
    },
  ): void => {
    const failure: DebugResult = {
      ok: false,
      results: [],
      errors: [{ error }],
      meta: {
        runner,
        forwardedArgs: [runner.cmd, ...runner.args],
        taskFilter: options.taskFilter,
        pendingTaskIds: [],
        mappingDiagnostics: [],
      },
    };
    output.write(failure);
  };

  let child: ReturnType<typeof spawnRunner> | null = null;
  let cdp: Awaited<ReturnType<typeof createCdpClient>> | null = null;

  try {
    const plan = await loadPlan(options.planPath);

    // Normalize runner args (enforce single worker, inspector, etc.)
    const normalizedRunner = normalizeRunnerArgs(plan.runner.args);
    if (normalizedRunner.error) {
      writeFailure(normalizedRunner.error, plan.runner);
      return;
    }
    plan.runner.args = normalizedRunner.args;

    // Filter tasks if specified
    const filteredIds = parseTaskFilter(options.taskFilter);
    const tasks = filteredIds.length
      ? plan.tasks.filter((task) => filteredIds.includes(task.id))
      : plan.tasks;

    if (!tasks.length) {
      writeFailure('No tasks matched the filter.', plan.runner);
      return;
    }

    // Spawn runner process
    child = spawnRunner(plan.runner);

    // Forward runner output to stderr so stdout stays valid JSON
    child.stdout?.on('data', (chunk) => process.stderr.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    // Wait for inspector to be ready
    const wsUrl = await waitForInspectorUrl(child);
    debugLog('inspector url', wsUrl);

    // Connect CDP and start debug session
    cdp = await createCdpClient(wsUrl);

    const session = new DebugSession({
      plan,
      options,
      tasks,
      cdp,
      runnerProcess: child,
      output,
      debugLog,
    });
    session.start();

    child.on('exit', (code) => session.onRunnerExit(code));
    await session.enableAndRun();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFailure(message);
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
    }
    cdp?.close();
  }
};
