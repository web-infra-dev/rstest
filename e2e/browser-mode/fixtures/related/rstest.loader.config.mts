import { mergeRstestConfig } from '@rstest/core';
import loaderConfig from '../../../filter/fixtures-related/rstest.loader.config.mts';
import config from './rstest.config.mts';

export default mergeRstestConfig(config, loaderConfig);
