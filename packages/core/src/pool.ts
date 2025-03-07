import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import * as RstestAPI from './api';
import { runner } from './runner';
import { logger } from './utils/logger';

type EntryInfo = {
  filePath: string;
  originPath: string;
};

export const runInPool = async ({
  filePath,
  originPath,
}: EntryInfo): Promise<void> => {
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

  await runner.run();
};
