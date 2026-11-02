import { mergeRstestConfig } from '@rstest/core';
import { createRootConfig } from './createRootConfig.mts';

export default async () =>
  mergeRstestConfig(createRootConfig(['packages/*']), {
    reporters: ['default'],
  });
