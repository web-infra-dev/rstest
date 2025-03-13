import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import * as RstestAPI from '../api';
import { type TestSuiteResult, runner } from '../runner';
import type { EntryInfo } from '../types';
import { logger } from '../utils/logger';

const runInPool = async ({
  filePath,
  originPath,
}: EntryInfo): Promise<TestSuiteResult> => {
  const codeContent = await fs.readFile(filePath, 'utf-8');
  const fileDir = path.dirname(originPath);

  const localModule = {
    children: [],
    exports: {},
    filename: originPath,
    id: originPath,
    isPreloading: false,
    loaded: false,
    path: fileDir,
  };

  const context = {
    module: localModule,
    require: createRequire(originPath),
    __dirname: fileDir,
    __filename: originPath,
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

  return results;
};

export default runInPool;
