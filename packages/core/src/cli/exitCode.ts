export function setHostExitCode(code: number): void {
  const hostCode = process.exitCode;
  if (hostCode !== undefined && hostCode !== 0 && hostCode !== '0') {
    return;
  }
  process.exitCode = code;
}
