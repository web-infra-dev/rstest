import type { ChildProcess } from 'node:child_process';
import { cac } from 'cac';
import {
  createOutputWriter,
  loadPlan,
  normalizeRunnerArgs,
  parseCliOptions,
  spawnRunner,
  waitForInspectorUrl,
} from './plan';
import { createCdpClient, DebugSession } from './session';
import type { CdpClient, DebugResult, RunnerConfig } from './types';

/** Wait for child process to exit with timeout */
const waitForExit = (
  child: ChildProcess,
  timeoutMs = 5000,
): Promise<number | null> => {
  return new Promise((resolve) => {
    if (child.exitCode != null) {
      resolve(child.exitCode);
      return;
    }
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      resolve(null);
    }, timeoutMs);
    const onExit = (code: number | null) => {
      clearTimeout(timeout);
      resolve(code);
    };
    child.once('exit', onExit);
  });
};

// ============================================================================
// CLI Argument Parsing
// ============================================================================

type ParsedArgs = {
  options: Record<string, unknown>;
  positional: string[];
  shouldExit: boolean;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  const cli = cac('rstest-cdp');

  cli.option('-p, --plan <path>', 'Path to plan JSON file (or "-" for stdin)');
  cli.option(
    '--output <path>',
    'Write JSON output to file (or "-" for stdout)',
  );
  cli.option(
    '--breakpoint-timeout <ms>',
    'Timeout for resolving breakpoints (default: 20000)',
  );
  cli.option(
    '--inactivity-timeout <ms>',
    'Timeout between breakpoint hits (default: 40000)',
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
      console.error('[rstest-cdp]', ...args);
    }
  };

  /** Write failure result and clean up */
  const writeFailure = (error: string, runner?: RunnerConfig): void => {
    const failure: DebugResult = {
      status: 'failed',
      results: [],
      errors: [{ error }],
      // Only include meta in debug mode when runner info is available
      ...(options.debug &&
        runner && {
          meta: {
            runner,
            forwardedArgs: [runner.cmd, ...runner.args],
            pendingTaskIds: [],
            mappingDiagnostics: [],
          },
        }),
    };
    output.write(failure);
  };

  let child: ChildProcess | null = null;
  let cdp: CdpClient | null = null;
  let isCleaningUp = false;

  /** Cleanup resources on exit */
  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    cdp?.close();
    if (child && child.exitCode == null) {
      child.kill('SIGTERM');
      await waitForExit(child);
    }
  };

  // Handle termination signals
  const onSignal = () => {
    debugLog('received termination signal, cleaning up...');
    cleanup().then(() => process.exit(1));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const plan = await loadPlan(options.planPath);

    // Normalize runner args (enforce single worker, inspector, etc.)
    const normalizedRunner = normalizeRunnerArgs(plan.runner.args);
    if (normalizedRunner.error) {
      writeFailure(normalizedRunner.error, plan.runner);
      return;
    }
    plan.runner.args = normalizedRunner.args;

    const tasks = plan.tasks;

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
    await cleanup();
  }
};
