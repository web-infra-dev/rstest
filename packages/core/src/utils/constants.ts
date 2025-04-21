import type { Rstest } from '../types';

export const DEFAULT_CONFIG_NAME = 'rstest.config';

export const TEST_DELIMITER = '>';

export const ROOT_SUITE_NAME = 'Rstest:_internal_root_suite';

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
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
];
