/**
 * The file task id. Pure string composition with no imports: node pool, the
 * browser runtime, and @rstest/browser's wire payloads must all derive file
 * identity the same way, so this module is dependency-free and every consumer
 * re-exports rather than rewriting the grammar.
 *
 * Node files are `file:<testPath>`. Browser rows carry their `project` and
 * `browserName` (`file:<project>:<browserName>:<testPath>`) because one file
 * runs once per browser.
 */
export function getFileTaskId(testPath: string): string;
export function getFileTaskId(file: {
  project: string;
  testPath: string;
  browserName?: string;
}): string;
export function getFileTaskId(
  file: string | { project: string; testPath: string; browserName?: string },
): string {
  if (typeof file === 'string') {
    return `file:${file}`;
  }
  return file.browserName === undefined
    ? `file:${file.testPath}`
    : `file:${file.project}:${file.browserName}:${file.testPath}`;
}
