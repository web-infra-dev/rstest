export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isTestFile(filename: string): boolean {
  const regex = /.*\.(test|spec)\.(c|m)?[jt]sx?$/;
  return regex.test(filename);
}
