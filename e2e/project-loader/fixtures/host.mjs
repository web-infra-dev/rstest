// Simulates a host (e.g. Rstack CLI) whose config files keep the test config
// under a `test` field instead of exporting an Rstest config.
import { loadConfig } from '@rsbuild/core';

export async function loadHostConfig(filePath) {
  const { content, dependencies } = await loadConfig({
    path: filePath,
    fresh: true,
  });
  return { content: content.test ?? {}, filePath, dependencies };
}
