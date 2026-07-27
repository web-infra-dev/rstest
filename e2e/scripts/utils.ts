import fs from 'node:fs';

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
  const match = stdout.match(new RegExp(`${marker}(.*?)__END__`));
  const payload = match?.[1];
  if (!payload) {
    throw new Error(
      `${marker} payload not found in stdout. Got:\n${stdout.slice(0, 4000)}`,
    );
  }
  return JSON.parse(payload) as T;
};
