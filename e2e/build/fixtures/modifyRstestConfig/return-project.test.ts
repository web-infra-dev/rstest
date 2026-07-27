import { expect, it } from '@rstest/core';
import { projectValue } from '@project-value';

declare const __MODIFIED_PROJECT__: string;
declare const __GET_RSTEST_CONFIG_POOL__: string;
declare const __GET_RSTEST_CONFIG_PROJECT__: string;

it('uses returned modified config with root placeholders', () => {
  expect(__MODIFIED_PROJECT__).toBe('return-project');
  expect(__GET_RSTEST_CONFIG_POOL__).toBe('forks');
  expect(__GET_RSTEST_CONFIG_PROJECT__).toBe('return-project');
  expect(projectValue).toBe('return-project');
  expect(
    (globalThis as typeof globalThis & { __PROJECT_SETUP_VALUE__: string })
      .__PROJECT_SETUP_VALUE__,
  ).toBe('return-project');
  expect(process.env.RSTEST_MODIFIED_RUNTIME).toBe('return-project');
});
