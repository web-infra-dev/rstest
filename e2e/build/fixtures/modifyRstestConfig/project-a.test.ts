import { expect, it } from '@rstest/core';
import { projectValue } from '@project-value';

declare const __MODIFIED_PROJECT__: string;

it('uses project-a modified config', () => {
  expect(__MODIFIED_PROJECT__).toBe('project-a');
  expect(projectValue).toBe('project-a');
  expect(
    (globalThis as typeof globalThis & { __PROJECT_SETUP_VALUE__: string })
      .__PROJECT_SETUP_VALUE__,
  ).toBe('project-a');
  expect(process.env.RSTEST_MODIFIED_RUNTIME).toBe('project-a');
});
