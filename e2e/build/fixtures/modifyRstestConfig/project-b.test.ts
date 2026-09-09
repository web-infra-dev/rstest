import { expect, it } from '@rstest/core';
import { projectValue } from '@project-value';

declare const __MODIFIED_PROJECT__: string;
declare const __GET_RSTEST_CONFIG_POOL__: string;
declare const __GET_RSTEST_CONFIG_PROJECT__: string;

it('uses project-b modified config', () => {
  expect(__MODIFIED_PROJECT__).toBe('project-b');
  expect(__GET_RSTEST_CONFIG_POOL__).toBe('forks');
  expect(__GET_RSTEST_CONFIG_PROJECT__).toBe('project-b');
  expect(projectValue).toBe('project-b');
  expect(
    (globalThis as typeof globalThis & { __PROJECT_SETUP_VALUE__: string })
      .__PROJECT_SETUP_VALUE__,
  ).toBe('project-b');
  expect(process.env.RSTEST_MODIFIED_RUNTIME).toBe('project-b');
});
