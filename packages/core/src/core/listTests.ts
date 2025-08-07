import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { createPool } from '../pool';
import type { ListCommandOptions, RstestContext, Test } from '../types';
import {
  color,
  getSetupFiles,
  getTaskNameWithPrefix,
  getTestEntries,
  logger,
  prettyTestPath,
} from '../utils';
import { createRsbuildServer, prepareRsbuild } from './rsbuild';

export async function listTests(
  context: RstestContext,
  fileFilters: string[],
  { filesOnly, json }: ListCommandOptions,
): Promise<void> {
  const {
    normalizedConfig: {
      include,
      exclude,
      root,
      name,
      setupFiles: setups,
      includeSource,
    },
    rootPath,
  } = context;

  const testEntries = await getTestEntries({
    include,
    exclude,
    root,
    fileFilters,
    includeSource,
  });

  const globTestSourceEntries = async (): Promise<Record<string, string>> => {
    return testEntries;
  };

  const setupFiles = getSetupFiles(setups, rootPath);

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const { getRsbuildStats, closeServer } = await createRsbuildServer({
    name,
    globTestSourceEntries,
    normalizedConfig: context.normalizedConfig,
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const { entries, setupEntries, assetFiles, sourceMaps, getSourcemap } =
    await getRsbuildStats();

  const pool = await createPool({
    context,
  });

  const list = await pool.collectTests({
    entries,
    sourceMaps,
    setupEntries,
    assetFiles,
  });
  const tests: {
    file: string;
    name?: string;
  }[] = [];

  const traverseTests = (test: Test) => {
    if (['skip', 'todo'].includes(test.runMode)) {
      return;
    }

    if (test.type === 'case') {
      tests.push({
        file: test.testPath,
        name: getTaskNameWithPrefix(test),
      });
    } else {
      for (const child of test.tests) {
        traverseTests(child);
      }
    }
  };

  const hasError = list.some((file) => file.errors?.length);

  if (hasError) {
    const { printError } = await import('../utils/error');
    process.exitCode = 1;
    for (const file of list) {
      const relativePath = relative(rootPath, file.testPath);

      if (file.errors?.length) {
        //  FAIL  tests/index.test.ts
        logger.log(`${color.bgRed(' FAIL ')} ${relativePath}`);

        for (const error of file.errors) {
          await printError(error, getSourcemap, rootPath);
        }
      }
    }

    await closeServer();

    await pool.close();
    return;
  }

  for (const file of list) {
    if (filesOnly) {
      tests.push({
        file: file.testPath,
      });
      continue;
    }
    for (const test of file.tests) {
      traverseTests(test);
    }
  }

  if (json && json !== 'false') {
    const content = JSON.stringify(tests, null, 2);
    if (json !== true && json !== 'true') {
      const jsonPath = isAbsolute(json) ? json : join(rootPath, json);
      mkdirSync(dirname(jsonPath), { recursive: true });
      writeFileSync(jsonPath, content);
    } else {
      logger.log(content);
    }
  } else {
    for (const test of tests) {
      const shortPath = relative(rootPath, test.file);
      logger.log(
        test.name
          ? `${color.dim(`${shortPath} > `)}${test.name}`
          : prettyTestPath(shortPath),
      );
    }
  }

  await closeServer();
  await pool.close();
}
