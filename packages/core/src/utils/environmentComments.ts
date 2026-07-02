import { open, stat } from 'node:fs/promises';
import type { BuiltinEnvironmentName, EnvironmentWithOptions } from '../types';

const MAX_COMMENT_BYTES = 4096;
const SUPPORTED_ENVIRONMENTS = ['node', 'jsdom', 'happy-dom'] as const;
const environmentCommentRE = /@(?:rstest|vitest|jest)-environment\s+([^\s*]+)/;
const environmentOptionsCommentRE =
  /@(?:rstest|vitest|jest)-environment-options\s+(.+?)(?:\r?\n|$)/;

export type EnvironmentComment = {
  name?: BuiltinEnvironmentName;
  options?: Record<string, unknown>;
};

type CachedEnvironmentComment = {
  mtimeMs: number;
  size: number;
  result: EnvironmentComment | null;
};

const environmentCommentCache = new Map<string, CachedEnvironmentComment>();

const supportedEnvironmentNames = new Set<string>(SUPPORTED_ENVIRONMENTS);

const isEnvironmentName = (name: string): name is BuiltinEnvironmentName =>
  supportedEnvironmentNames.has(name);

const canStartRegexLiteral = (code: string, index: number): boolean => {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(code[cursor]!)) {
    cursor -= 1;
  }

  if (cursor < 0) {
    return true;
  }

  const char = code[cursor]!;
  if ('([{=,:;!&|?+-*%^~<>'.includes(char)) {
    return true;
  }

  return /\b(?:return|throw|case|delete|void|typeof|instanceof|in|yield|await)\s*$/.test(
    code.slice(0, cursor + 1),
  );
};

const skipRegexLiteral = (code: string, index: number): number | null => {
  let cursor = index + 1;
  let inCharacterClass = false;

  while (cursor < code.length) {
    const char = code[cursor]!;

    if (char === '\\') {
      cursor += 2;
      continue;
    }

    if (char === '[') {
      inCharacterClass = true;
      cursor += 1;
      continue;
    }

    if (char === ']') {
      inCharacterClass = false;
      cursor += 1;
      continue;
    }

    if (char === '/' && !inCharacterClass) {
      cursor += 1;
      while (cursor < code.length && /[a-z]/i.test(code[cursor]!)) {
        cursor += 1;
      }
      return cursor;
    }

    cursor += 1;
  }

  return null;
};

const readCommentText = (code: string): string => {
  const comments: string[] = [];
  let index = 0;

  while (index < code.length) {
    const char = code[index];
    const nextChar = code[index + 1];

    if (char === '/' && nextChar === '/') {
      const start = index + 2;
      index = start;
      while (
        index < code.length &&
        code[index] !== '\n' &&
        code[index] !== '\r'
      ) {
        index += 1;
      }
      comments.push(code.slice(start, index));
      if (code[index] === '\r' && code[index + 1] === '\n') {
        index += 2;
      } else if (code[index] === '\r' || code[index] === '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && nextChar === '*') {
      const start = index + 2;
      index = start;
      while (
        index < code.length &&
        !(code[index] === '*' && code[index + 1] === '/')
      ) {
        index += 1;
      }
      comments.push(code.slice(start, index));
      if (index < code.length) {
        index += 2;
      }
      continue;
    }

    if (char === '/' && canStartRegexLiteral(code, index)) {
      const nextIndex = skipRegexLiteral(code, index);
      if (nextIndex) {
        index = nextIndex;
        continue;
      }
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char;
      index += 1;
      while (index < code.length) {
        const current = code[index];
        if (current === '\\') {
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) {
          break;
        }
      }
      continue;
    }

    index += 1;
  }

  return comments.join('\n');
};

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

  const commentText = readCommentText(code);
  const environmentMatch = environmentCommentRE.exec(commentText);
  const optionsMatch = environmentOptionsCommentRE.exec(commentText);

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
  const target =
    name === baseEnvironment.name ? baseEnvironment.target : undefined;
  const options =
    name === baseEnvironment.name
      ? { ...(baseEnvironment.options || {}), ...(comment.options || {}) }
      : comment.options;
  const environment =
    options && Object.keys(options).length > 0 ? { name, options } : { name };

  return target ? { ...environment, target } : environment;
};
