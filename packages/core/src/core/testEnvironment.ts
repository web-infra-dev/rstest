import type { EnvironmentWithOptions } from '../types';

export type TestEnvironmentTransformMode = 'node' | 'browser';

export const getTestEnvironmentTransformMode = (
  testEnvironment: EnvironmentWithOptions,
): TestEnvironmentTransformMode => {
  if (testEnvironment.transformMode) {
    return testEnvironment.transformMode;
  }

  return testEnvironment.name === 'jsdom' || testEnvironment.name === 'happy-dom'
    ? 'browser'
    : 'node';
};

export const isNodeLikeTestEnvironment = (
  testEnvironment: EnvironmentWithOptions,
): boolean => getTestEnvironmentTransformMode(testEnvironment) === 'node';