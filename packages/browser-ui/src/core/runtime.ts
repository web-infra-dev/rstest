export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16_000, 30_000];

export const createRunId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const createWebSocketUrl = (wsPort: number): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:${wsPort}`;
};

/**
 * Resolve the runner origin for a test file's project. Each browser project
 * runs on its own dev server, so the container must load that file's iframe
 * from the project's own origin. Falls back to the container-level `runnerUrl`
 * (and ultimately the container origin) when no per-project URL is known.
 */
export const resolveRunnerBase = (
  options: {
    projectRunnerUrls?: Record<string, string>;
    runnerUrl?: string;
  },
  projectName: string | undefined,
): string | undefined => {
  if (projectName && options.projectRunnerUrls?.[projectName]) {
    return options.projectRunnerUrls[projectName];
  }
  return options.runnerUrl;
};

export const createRunnerUrl = (
  testFile: string,
  runnerBase?: string,
  testNamePattern?: string,
  cacheBust = false,
  runId?: string,
): string => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  if (testNamePattern) {
    url.searchParams.set('testNamePattern', testNamePattern);
  }
  if (runId) {
    url.searchParams.set('runId', runId);
  }
  if (cacheBust) {
    url.searchParams.set('t', Date.now().toString());
  }
  return url.toString();
};
