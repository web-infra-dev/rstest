import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import * as RstestAPI from '../api';
import { runner } from '../runner';
import type { EntryInfo } from '../types';
import { logger } from '../utils/logger';

const runInPool = async ({
  filePath,
  originPath,
}: EntryInfo): Promise<{
  hasFailed: boolean;
}> => {
  const codeContent = await fs.readFile(filePath, 'utf-8');

  const localModule = {
    children: [],
    exports: {},
    filename: originPath,
    id: originPath,
    isPreloading: false,
    loaded: false,
    path: path.dirname(originPath),
  };

  const context = {
    module: localModule,
    require: createRequire(originPath),
    global: {
      '@rstest/core': RstestAPI,
    },
  };

  const code = `'use strict';(${Object.keys(context).join(',')})=>{{
   ${codeContent}
  }}`;

  const fn = vm.runInThisContext(code);
  fn(...Object.values(context));

  if (runner.suites.length === 0) {
    logger.error(`No test suites found in file: ${originPath}`);
  }

  const results = await runner.run();

  return {
    hasFailed: results.some((suite) => suite.status === 'fail'),
  };
};

export default runInPool;
