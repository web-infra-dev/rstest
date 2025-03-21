import type { Rstest } from './types';

export const DEFAULT_CONFIG_NAME = 'rstest.config';

export const DEFAULT_CONFIG_EXTENSIONS = [
  '.js',
  '.ts',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

export const globalApis: (keyof Rstest)[] = [
  'test',
  'describe',
  'it',
  'expect',
];
