import type { ProjectContext } from '../types';

/**
 * The single routing predicate for browser vs node mode. `browser.enabled` is
 * frozen pre-plugin (it cannot be changed in `modifyRstestConfig`), so every
 * executor-routing decision — plan resolution, environment grouping, worker
 * setup, list collection — reads it through this one helper instead of inlining
 * `project.normalizedConfig.browser.enabled` at each site.
 */
export const isBrowserProject = (project: ProjectContext): boolean =>
  project.normalizedConfig.browser.enabled;

/** Convenience negation for the common "node projects" filter. */
export const isNodeProject = (project: ProjectContext): boolean =>
  !project.normalizedConfig.browser.enabled;
