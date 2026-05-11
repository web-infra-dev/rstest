import { beforeEach } from '@rstest/core';
import { cleanup } from './pure.react17';

beforeEach(async () => {
  await cleanup();
});

export * from './pure.react17';
