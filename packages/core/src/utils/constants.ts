import type { Rstest } from '../types';

export const DEFAULT_CONFIG_NAME = 'rstest.config';

export const TEST_DELIMITER = '>';

export const POINTER = '➜';

export const ROOT_SUITE_NAME = 'Rstest:_internal_root_suite';

export const TEMP_RSTEST_OUTPUT_DIR = 'dist/.rstest-temp';

export const TEMP_RSTEST_OUTPUT_DIR_GLOB = '**/dist/.rstest-temp';

export const DEFAULT_CONFIG_EXTENSIONS = [
  '.js',
  '.ts',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
] as const;

export const BROWSER_VIEWPORT_PRESET_IDS = [
  'iPhoneSE',
  'iPhoneXR',
  'iPhone12Pro',
  'iPhone14ProMax',
  'Pixel7',
  'SamsungGalaxyS8Plus',
  'SamsungGalaxyS20Ultra',
  'iPadMini',
  'iPadAir',
  'iPadPro',
  'SurfacePro7',
  'SurfaceDuo',
  'GalaxyZFold5',
  'AsusZenbookFold',
  'SamsungGalaxyA51A71',
  'NestHub',
  'NestHubMax',
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
