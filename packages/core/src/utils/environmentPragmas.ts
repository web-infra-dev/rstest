import { open, stat } from 'node:fs/promises';
import type { EnvironmentName, EnvironmentWithOptions } from '../types';

const MAX_PRAGMA_BYTES = 4096;
const SUPPORTED_ENVIRONMENTS = ['node', 'jsdom', 'happy-dom'] as const;
const environmentPragmaRE = /@(?:rstest|vitest|jest)-environment\s+([^\s*]+)/;
const environmentOptionsPragmaRE =
  /@(?:rstest|vitest|jest)-environment-options\s+(.+?)(?:\r?\n|$)/;

export type EnvironmentPragma = {
  name?: EnvironmentName;
  options?: Record<string, unknown>;
};

type CachedPragma = {
  mtimeMs: number;
  size: number;
  result: EnvironmentPragma | null;
};

const pragmaCache = new Map<string, CachedPragma>();

const isEnvironmentName = (name: string): name is EnvironmentName =>
  SUPPORTED_ENVIRONMENTS.includes(name as EnvironmentName);

const readFileHead = async (file: string): Promise<string> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(MAX_PRAGMA_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, MAX_PRAGMA_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await handle.close();
  }
};

const normalizeOptionsText = (text: string): string =>
  text.trim().replace(/^\*/, '').trim().replace(/\*\/$/, '').trim();

const isFileNotFoundError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

export const parseEnvironmentPragma = (
  code: string,
  filePath = '<inline>',
): EnvironmentPragma | null => {
  if (!code.includes('@') || !code.includes('environment')) {
    return null;
  }

  const environmentMatch = environmentPragmaRE.exec(code);
  const optionsMatch = environmentOptionsPragmaRE.exec(code);

  if (!environmentMatch && !optionsMatch) {
    return null;
  }

  const pragma: EnvironmentPragma = {};
  const environmentName = environmentMatch?.[1];
  if (environmentName) {
    if (!isEnvironmentName(environmentName)) {
      throw new Error(
        `Unsupported test environment "${environmentName}" in ${filePath}. Supported environments: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`,
      );
    }
    pragma.name = environmentName;
  }

  const optionsText = optionsMatch?.[1];
  if (optionsText) {
    try {
      const parsed = JSON.parse(normalizeOptionsText(optionsText));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('environment options must be a JSON object');
      }
      pragma.options = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse test environment options in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return pragma;
};

export const parseEnvironmentPragmaFromFile = async (
  file: string,
): Promise<EnvironmentPragma | null> => {
  const fileStat = await stat(file).catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });

  if (!fileStat) {
    return null;
  }

  const cached = pragmaCache.get(file);

  if (cached?.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
    return cached.result;
  }

  const head = await readFileHead(file);
  const result = parseEnvironmentPragma(head, file);

  pragmaCache.set(file, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    result,
  });

  return result;
};

export const applyEnvironmentPragma = (
  baseEnvironment: EnvironmentWithOptions,
  pragma: EnvironmentPragma,
): EnvironmentWithOptions => {
  const name = pragma.name ?? baseEnvironment.name;
  const options =
    name === baseEnvironment.name
      ? { ...(baseEnvironment.options || {}), ...(pragma.options || {}) }
      : pragma.options;

  return options && Object.keys(options).length > 0
    ? { name, options }
    : { name };
};
