import type { ProjectContext } from '../types';

/**
 * The kind of executor a project runs on. Node projects run in the worker
 * pool (forks/threads); browser projects run in the `@rstest/browser` host.
 */
export type ExecutorKind = 'node' | 'browser';

/**
 * The single classifier for `browser.enabled`. Every scheduling site that needs
 * to split projects into node vs browser routes through this function instead of
 * reading `project.normalizedConfig.browser.enabled` directly, so the
 * node/browser boundary has exactly one definition.
 */
export function kindOf(project: ProjectContext): ExecutorKind {
  return project.normalizedConfig.browser.enabled ? 'browser' : 'node';
}
