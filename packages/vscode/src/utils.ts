import type * as vscode from 'vscode';

export function shouldIgnoreUri(uri: vscode.Uri) {
  return (
    uri.scheme !== 'file' ||
    uri.path.includes('/node_modules/') ||
    uri.path.includes('/.git/') ||
    uri.path.endsWith('.git')
  );
}

export function isTestFile(filename: string): boolean {
  const regex = /.*\.(test|spec)\.(c|m)?[jt]sx?$/;
  return regex.test(filename);
}

export function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  error: Error,
) {
  return Promise.race<T>([
    promise,
    new Promise((_, reject) => setTimeout(reject, timeout, error)),
  ]);
}
