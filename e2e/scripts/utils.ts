import fs from 'node:fs';
import { normalize } from 'pathe';

export const getCoverageSummaryEntry = <T>(
  summary: Record<string, T>,
  filePath: string,
): T | undefined => {
  const normalizedFilePath = normalize(filePath);
  return Object.entries(summary).find(
    ([reportedPath]) => normalize(reportedPath) === normalizedFilePath,
  )?.[1];
};

export const getTestName = (log: string, prefix: string) =>
  log.slice(0, log.lastIndexOf('(')).split(prefix)[1]!.trim();

export const expectFile = async (filePath: string, timeout = 3000) => {
  const { expect } = await import('@rstest/core');
  return expect
    .poll(() => fs.existsSync(filePath), {
      timeout,
    })
    .toBeTruthy();
};

export const sleep = (ms: number) => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

/**
 * Extracts a `<marker>...__END__` JSON payload that a fixture reporter or
 * script printed to stdout. Each suite prints under its own marker.
 */
export const parseMarkerPayload = <T>(stdout: string, marker: string): T => {
  const start = stdout.indexOf(marker);
  const end = start === -1 ? -1 : stdout.indexOf('__END__', start);
  if (start === -1 || end === -1) {
    throw new Error(
      `${marker} payload not found in stdout. Got:\n${stdout.slice(0, 4000)}`,
    );
  }
  return JSON.parse(stdout.slice(start + marker.length, end)) as T;
};

export const expectReporterHookJoins = async (
  events: { event: string; testId?: string; testPath?: string }[],
) => {
  const { expect } = await import('@rstest/core');
  const starts = events.filter(({ event }) => event === 'start-enter');
  expect(starts.length).toBeGreaterThan(0);
  for (const start of starts) {
    const indexOf = (event: string) =>
      events.findIndex(
        (entry) => entry.event === event && entry.testId === start.testId,
      );
    const resultEnter = indexOf('result-enter');
    const startExit = indexOf('start-exit');
    const resultExit = indexOf('result-exit');
    const fileResult = events.findIndex(
      (entry) =>
        entry.event === 'file-result' && entry.testPath === start.testPath,
    );
    expect(resultEnter).toBeGreaterThan(-1);
    expect(startExit).toBeGreaterThan(resultEnter);
    expect(resultExit).toBeGreaterThan(resultEnter);
    expect(fileResult).toBeGreaterThan(startExit);
    expect(fileResult).toBeGreaterThan(resultExit);
  }
  expect(events.at(-1)?.event).toBe('run-end');
};
