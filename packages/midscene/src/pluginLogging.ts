import { color, logger } from '@rstest/core/browser';
import type { AiRpcMethod } from './protocol';

type MidsceneExecutionTaskLike = {
  hitBy?: unknown;
};

type MidsceneExecutionDumpLike = {
  tasks?: MidsceneExecutionTaskLike[];
};

type MidsceneDumpLike = {
  executions?: MidsceneExecutionDumpLike[];
};

export type MidsceneLogAgent = {
  dump?: MidsceneDumpLike;
  reportFile?: string | null;
};

const MIDSCENE_PREFIX = `${color.dim('[')}${color.cyan('midscene')}${color.dim(']')}`;

const METHOD_LOG_LABELS: Record<AiRpcMethod, string> = {
  ai: 'AI action',
  aiTap: 'AI tap',
  aiRightClick: 'AI right click',
  aiDoubleClick: 'AI double click',
  aiHover: 'AI hover',
  aiInput: 'AI input',
  aiKeyboardPress: 'AI keyboard press',
  aiScroll: 'AI scroll',
  aiAct: 'AI action',
  aiQuery: 'AI query',
  aiAssert: 'AI assertion',
  aiWaitFor: 'AI wait',
  aiLocate: 'AI locate',
  aiBoolean: 'AI boolean check',
  aiNumber: 'AI number query',
  aiString: 'AI text query',
  aiAsk: 'AI ask',
  runYaml: 'YAML flow',
  setAIActContext: 'AI action context update',
  evaluateJavaScript: 'JavaScript evaluation',
  recordToReport: 'Report record',
  freezePageContext: 'Page context freeze',
  unfreezePageContext: 'Page context unfreeze',
};

const METHODS_WITH_PREVIEW = new Set<AiRpcMethod>([
  'ai',
  'aiTap',
  'aiRightClick',
  'aiDoubleClick',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiAct',
  'aiQuery',
  'aiAssert',
  'aiWaitFor',
  'aiLocate',
  'aiBoolean',
  'aiNumber',
  'aiString',
  'aiAsk',
  'setAIActContext',
  'recordToReport',
]);

const CACHE_AWARE_METHODS = new Set<AiRpcMethod>([
  'ai',
  'aiAct',
  'aiTap',
  'aiRightClick',
  'aiDoubleClick',
  'aiHover',
  'aiInput',
  'aiKeyboardPress',
  'aiScroll',
  'aiLocate',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getLatestExecutionDump = (
  agent: MidsceneLogAgent,
): MidsceneExecutionDumpLike | undefined => {
  const executions = agent.dump?.executions;
  if (!Array.isArray(executions) || executions.length === 0) {
    return undefined;
  }

  return executions[executions.length - 1];
};

const hasCacheHit = (executionDump: MidsceneExecutionDumpLike): boolean => {
  if (!Array.isArray(executionDump.tasks)) {
    return false;
  }

  return executionDump.tasks.some((task) => task.hitBy !== undefined);
};

const getCacheStatusLabel = (
  method: AiRpcMethod,
  executionDump: MidsceneExecutionDumpLike | undefined,
): string | undefined => {
  if (!CACHE_AWARE_METHODS.has(method) || !executionDump) {
    return undefined;
  }

  return hasCacheHit(executionDump) ? 'cache hit' : 'model call';
};

const formatDuration = (durationMs: number): string => {
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
};

const formatPromptPreview = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (!compact) {
      return undefined;
    }
    return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  }

  if (isObject(value) && typeof value.prompt === 'string') {
    return formatPromptPreview(value.prompt);
  }

  return undefined;
};

const formatMethodLabel = (method: AiRpcMethod, args: unknown[]): string => {
  const label = METHOD_LOG_LABELS[method];
  if (!METHODS_WITH_PREVIEW.has(method)) {
    return label;
  }

  const preview = formatPromptPreview(args[0]);
  return preview ? `${label} - ${preview}` : label;
};

const formatStatusLabel = (status: 'start' | 'done'): string => {
  const label = status.padEnd(5, ' ');
  if (status === 'start') {
    return color.yellow(label);
  }

  return color.green(label);
};

const formatCacheStatus = (status: string | undefined): string => {
  if (!status) {
    return '';
  }

  if (status === 'cache hit') {
    return ` ${color.dim('(')}${color.green(status)}${color.dim(')')}`;
  }

  return ` ${color.dim('(')}${color.yellow(status)}${color.dim(')')}`;
};

export const logMidsceneInfo = (message: string): void => {
  logger.log(`${MIDSCENE_PREFIX} ${message}`);
};

export const logMidsceneWarning = (message: string): void => {
  logger.warn(`${MIDSCENE_PREFIX} ${color.yellow(message)}`);
};

export const logMidscenePluginInitialized = (): void => {
  logMidsceneInfo(color.green('plugin initialized'));
};

export const logMidsceneEnvLoaded = (envPath: string): void => {
  logMidsceneInfo(`loaded .env from ${color.dim(envPath)}`);
};

export const logMidsceneMethodStart = (
  method: AiRpcMethod,
  args: unknown[],
): void => {
  const methodLabel = formatMethodLabel(method, args);
  logMidsceneInfo(`${formatStatusLabel('start')} ${color.bold(methodLabel)}`);
};

export const logMidsceneMethodFinish = (
  method: AiRpcMethod,
  args: unknown[],
  durationMs: number,
  agent: MidsceneLogAgent,
): void => {
  const methodLabel = formatMethodLabel(method, args);
  const duration = formatDuration(durationMs);
  const cacheStatus = getCacheStatusLabel(
    method,
    getLatestExecutionDump(agent),
  );
  logMidsceneInfo(
    `${formatStatusLabel('done')} ${color.bold(methodLabel)} ${color.dim('in')} ${color.bold(duration)}${formatCacheStatus(cacheStatus)}`,
  );
};

export const appendReportPathToError = (
  error: unknown,
  reportFile: string | null | undefined,
): Error => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  if (!reportFile) {
    return normalized;
  }

  const reportMessage = `Midscene report: ${reportFile}`;
  if (!normalized.message.includes(reportMessage)) {
    normalized.message = `${normalized.message}\n\n${reportMessage}`;
  }

  return normalized;
};
