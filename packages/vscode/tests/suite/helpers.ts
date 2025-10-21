export async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForConfigValue<T>({
  initialValue,
  read,
  expected,
  timeoutMs = 2000,
  pollMs = 25,
}: {
  initialValue: T;
  read: () => T;
  expected: T;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<T> {
  const start = Date.now();
  let value = initialValue;

  while (value !== expected && Date.now() - start < timeoutMs) {
    await delay(pollMs);
    value = read();
  }

  return value;
}
