/**
 * The `(project, browser, testPath)` task id. Pure string composition with no
 * imports: node pool, the browser runtime, and @rstest/browser's wire payloads
 * must all derive file identity the same way, so this module is dependency-free
 * and every consumer re-exports rather than rewriting the grammar.
 */
export const getFileTaskId = (file: {
  project: string;
  testPath: string;
  browserName?: string;
}): string =>
  `file:${file.project}:${file.browserName !== undefined ? `${file.browserName}:` : ''}${file.testPath}`;
