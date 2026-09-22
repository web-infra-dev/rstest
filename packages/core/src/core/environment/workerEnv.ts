export function composeWorkerEnv(
  workerEnv: Readonly<Record<string, string | undefined>>,
  baseEnv: Readonly<NodeJS.ProcessEnv> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(workerEnv)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}
