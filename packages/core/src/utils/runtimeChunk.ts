export const RSTEST_RUNTIME_CHUNK_PREFIX = '__rstest_runtime__';

export const getRuntimeChunkName = (environmentName: string): string =>
  `${RSTEST_RUNTIME_CHUNK_PREFIX}${environmentName}`;
