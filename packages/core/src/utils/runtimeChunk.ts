export const RSTEST_RUNTIME_CHUNK_PREFIX = '__rstest_runtime__';

export const getRuntimeChunkName = (environmentName: string): string =>
  `${RSTEST_RUNTIME_CHUNK_PREFIX}${environmentName}`;

export const isRuntimeChunkFilePath = (distPath: string): boolean => {
  const normalizedPath = distPath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  const basename =
    lastSlashIndex === -1
      ? normalizedPath
      : normalizedPath.slice(lastSlashIndex + 1);

  return (
    basename.startsWith(RSTEST_RUNTIME_CHUNK_PREFIX) &&
    basename.endsWith('.mjs')
  );
};
