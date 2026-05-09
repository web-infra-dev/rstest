import { spawnSync } from 'node:child_process';
import { color, logger } from '../utils/logger';

const PROFILE_FLAG = '--profile';
const PROFILE_FLAG_EQ = `${PROFILE_FLAG}=`;
const SAFE_SHELL_ARG = /^[\w./=:@-]+$/;

const SAMPLY_NODE_FLAGS = [
  '--perf-prof',
  '--perf-basic-prof',
  '--interpreted-frames-native-stack',
] as const;

type ParsedProfile = { mode: string; restArgs: string[] };

function parseProfileArgs(argv: readonly string[]): ParsedProfile | null {
  let mode: string | null = null;
  const restArgs: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === PROFILE_FLAG) {
      mode ??= 'samply';
      continue;
    }
    if (arg.startsWith(PROFILE_FLAG_EQ)) {
      mode ??= arg.slice(PROFILE_FLAG_EQ.length) || 'samply';
      continue;
    }
    restArgs.push(arg);
  }
  return mode ? { mode, restArgs } : null;
}

function shellQuote(arg: string): string {
  if (arg.length > 0 && SAFE_SHELL_ARG.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function isSamplyInstalled(): boolean {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const { status } = spawnSync(which, ['samply'], { stdio: 'ignore' });
  return status === 0;
}

function buildSamplyCommand(restArgs: readonly string[]): string {
  const entry = process.argv[1] ?? '';
  return [
    'samply',
    'record',
    '--',
    'node',
    ...SAMPLY_NODE_FLAGS,
    entry,
    ...restArgs,
  ]
    .map(shellQuote)
    .join(' ');
}

/**
 * Intercept `--profile[=samply]` before the normal CLI runs.
 *
 * Behavior: detect samply in PATH, then print the resolved samply command
 * (with rstest entry path baked in) and exit. We deliberately do not spawn
 * samply from rstest — that would force rstest to forward signals, exit
 * codes, argv quoting, and NODE_OPTIONS merging, none of which are worth
 * the cost for a copy-paste shortcut.
 *
 * @returns true when the flag was handled (caller must not continue).
 */
export function maybeHandleProfileShortcut(): boolean {
  const parsed = parseProfileArgs(process.argv);
  if (!parsed) return false;

  if (parsed.mode !== 'samply') {
    logger.error(`Unknown --profile mode: "${parsed.mode}". Supported: samply`);
    process.exit(1);
  }

  const cmd = buildSamplyCommand(parsed.restArgs);

  if (!isSamplyInstalled()) {
    logger.error(
      'samply is required for --profile=samply but was not found in PATH.',
    );
    logger.log('');
    logger.log('  Install samply:');
    logger.log(`    ${color.cyan('cargo install samply')}`);
    logger.log(
      `    ${color.gray('# or on macOS:')} ${color.cyan('brew install samply')}`,
    );
    logger.log('');
    logger.log('  After installing, run:');
    logger.log('');
    logger.log(`    ${color.green(cmd)}`);
    logger.log('');
    process.exit(1);
  }

  logger.log(`samply detected ${color.green('✓')}`);
  logger.log('');
  logger.log('Run this command to profile:');
  logger.log('');
  logger.log(`  ${color.green(cmd)}`);
  logger.log('');
  return true;
}
