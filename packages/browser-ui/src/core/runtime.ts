export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16_000, 30_000];

export const createWebSocketUrl = (wsPort: number): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:${wsPort}`;
};

export const createRunnerUrl = (
  testFile: string,
  runnerBase?: string,
  testNamePattern?: string,
  cacheBust = false,
): string => {
  const base = runnerBase || window.location.origin;
  const url = new URL('/runner.html', base);
  url.searchParams.set('testFile', testFile);
  if (testNamePattern) {
    url.searchParams.set('testNamePattern', testNamePattern);
  }
  if (cacheBust) {
    url.searchParams.set('t', Date.now().toString());
  }
  return url.toString();
};
