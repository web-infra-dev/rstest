import { loadConfig, type RstestConfig } from '@rstest/core';
import {
  createRstest,
  type CreateRstestOptions,
  type RstestConfigFn,
} from '@rstest/core/api';

declare const config: RstestConfig;

const configFactory: RstestConfigFn = async () => config;
const configOptions: CreateRstestOptions = { config };
const factoryOptions: CreateRstestOptions = { config: configFactory };
const createFromLoadedConfig = async (): Promise<void> => {
  const loaded = await loadConfig({ cwd: '' });
  await createRstest({ config: loaded.content });
};

void configOptions;
void factoryOptions;
void createFromLoadedConfig;
