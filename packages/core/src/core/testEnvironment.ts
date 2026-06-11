import type { EnvironmentWithOptions } from '../types';

export type TestEnvironmentTarget = 'node' | 'web';

export const getTestEnvironmentTarget = (
  testEnvironment: EnvironmentWithOptions,
): TestEnvironmentTarget => {
  if (testEnvironment.target) {
    return testEnvironment.target;
  }

  return testEnvironment.name === 'jsdom' ||
    testEnvironment.name === 'happy-dom'
    ? 'web'
    : 'node';
};

export const isNodeLikeTestEnvironment = (
  testEnvironment: EnvironmentWithOptions,
): boolean => getTestEnvironmentTarget(testEnvironment) === 'node';
