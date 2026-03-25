export function isTestFile(filename: string): boolean {
  const regex = /.*\.(test|spec)\.(c|m)?[jt]sx?$/;
  return regex.test(filename);
}
