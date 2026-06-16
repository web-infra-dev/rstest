import { open, stat } from 'node:fs/promises';
import type { EnvironmentName, EnvironmentWithOptions } from '../types';

const MAX_COMMENT_BYTES = 4096;
const SUPPORTED_ENVIRONMENTS = ['node', 'jsdom', 'happy-dom'] as const;
const environmentCommentRE = /@(?:rstest|vitest|jest)-environment\s+([^\s*]+)/;
const environmentOptionsCommentRE =
  /@(?:rstest|vitest|jest)-environment-options\s+(.+?)(?:\r?\n|$)/;

export type EnvironmentComment = {
  name?: EnvironmentName;
  options?: Record<string, unknown>;
};

type CachedEnvironmentComment = {
  mtimeMs: number;
  size: number;
  result: EnvironmentComment | null;
};

const environmentCommentCache = new Map<string, CachedEnvironmentComment>();

const isEnvironmentName = (name: string): name is EnvironmentName =>
  SUPPORTED_ENVIRONMENTS.includes(name as EnvironmentName);

const readFileHead = async (file: string): Promise<string> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_COMMENT_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_COMMENT_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
};

const normalizeOptionsText = (text: string): string =>
  text.trim().replace(/^\*/, '').trim().replace(/\*\/$/, '').trim();

const isFileNotFoundError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const parseEnvironmentComment = (
  code: string,
  filePath = '<inline>',
): EnvironmentComment | null => {
  if (!code.includes('@') || !code.includes('environment')) {
    return null;
  }

  const environmentMatch = environmentCommentRE.exec(code);
  const optionsMatch = environmentOptionsCommentRE.exec(code);

  if (!environmentMatch && !optionsMatch) {
    return null;
  }

  const comment: EnvironmentComment = {};
  const environmentName = environmentMatch?.[1];
  if (environmentName) {
    if (!isEnvironmentName(environmentName)) {
      throw new Error(
        `Unsupported test environment "${environmentName}" in ${filePath}. Supported environments: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`,
      );
    }
    comment.name = environmentName;
  }

  const optionsText = optionsMatch?.[1];
  if (optionsText) {
    try {
      const parsed = JSON.parse(normalizeOptionsText(optionsText));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('environment options must be a JSON object');
      }
      comment.options = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse test environment options in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return comment;
};

export const parseEnvironmentCommentFromFile = async (
  file: string,
): Promise<EnvironmentComment | null> => {
  const fileStat = await stat(file).catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });

  if (!fileStat) {
    return null;
  }

  const cached = environmentCommentCache.get(file);

  if (cached?.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.result;
  }

  const head = await readFileHead(file);
  const result = parseEnvironmentComment(head, file);

  environmentCommentCache.set(file, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    result,
  });

  return result;
};

export const applyEnvironmentComment = (
  baseEnvironment: EnvironmentWithOptions,
  comment: EnvironmentComment,
): EnvironmentWithOptions => {
  const name = comment.name ?? baseEnvironment.name;
  const options =
    name === baseEnvironment.name
      ? { ...(baseEnvironment.options || {}), ...(comment.options || {}) }
      : comment.options;

  return options && Object.keys(options).length > 0
    ? { name, options }
    : { name };
};
