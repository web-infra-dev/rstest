import {
  type ProjectContext,
  type Rstest,
  type RuntimeConfig,
  serializableConfig,
} from '@rstest/core/browser';

export const getBrowserProjects = (context: Rstest): ProjectContext[] => {
  return context.projects.filter(
    (project) => project.normalizedConfig.browser.enabled,
  );
};

export const getRuntimeConfigFromProject = (
  project: ProjectContext,
): RuntimeConfig => {
  const {
    testNamePattern,
    testTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    hookTimeout,
    isolate,
    coverage,
    snapshotFormat,
    env,
    bail,
    logHeapUsage,
    chaiConfig,
    includeTaskLocation,
  } = project.normalizedConfig;

  return serializableConfig({
    env,
    testNamePattern,
    testTimeout,
    hookTimeout,
    passWithNoTests,
    retry,
    globals,
    clearMocks,
    resetMocks,
    restoreMocks,
    unstubEnvs,
    unstubGlobals,
    maxConcurrency,
    printConsoleTrace,
    disableConsoleIntercept,
    testEnvironment,
    isolate,
    coverage,
    snapshotFormat,
    bail,
    logHeapUsage,
    chaiConfig,
    includeTaskLocation,
  });
};
