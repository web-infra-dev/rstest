import { isAbsolute, join, normalize } from 'pathe';
import type { Rstest, RstestConfig } from '../types';

export const DEFAULT_CONFIG_NAME = 'rstest.config';

export const TEST_DELIMITER = '>';

export const POINTER = '➜';

export const ROOT_SUITE_NAME = 'Rstest:_internal_root_suite';

export const TEMP_RSTEST_OUTPUT_DIR = 'dist/.rstest-temp';

export const getOutputDistPathRoot = (
  distPath?: NonNullable<RstestConfig['output']>['distPath'],
): string =>
  (typeof distPath === 'string' ? distPath : distPath?.root) ??
  TEMP_RSTEST_OUTPUT_DIR;

export const getTempRstestOutputDir = ({
  distPathRoot,
  environmentName,
  multipleProjects = false,
}: {
  distPathRoot: string;
  environmentName?: string;
  multipleProjects?: boolean;
}): string => {
  const outputRoot = normalize(distPathRoot);
  return multipleProjects && environmentName
    ? join(outputRoot, environmentName)
    : outputRoot;
};

export const getTempRstestOutputDirGlob = (distPathRoot: string): string => {
  const outputRoot = normalize(distPathRoot);

  if (isAbsolute(outputRoot)) {
    return outputRoot;
  }

  return `**/${outputRoot.replace(/^\.?\//, '')}`;
};

export const DEFAULT_CONFIG_EXTENSIONS = [
  '.mts',
  '.mjs',
  '.ts',
  '.js',
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
  'rstest',
  'rs',
  'assert',
  'onTestFinished',
  'onTestFailed',
];

export const TS_CONFIG_FILE = 'tsconfig.json';
