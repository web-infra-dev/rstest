import type { BuiltinEnvironmentName, TestEnvironment } from '../types';
import { environment as happyDomEnvironment } from './worker/env/happyDom';
import { environment as jsdomEnvironment } from './worker/env/jsdom';
import { environment as nodeEnvironment } from './worker/env/node';

export const builtinEnvironments: Record<
  BuiltinEnvironmentName,
  TestEnvironment
> = {
  node: nodeEnvironment,
  jsdom: jsdomEnvironment,
  'happy-dom': happyDomEnvironment,
};
