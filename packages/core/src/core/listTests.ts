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
  const { rootPath } = context;

  const testEntries: Record<string, Record<string, string>> = {};

  const globTestSourceEntries = async (
    name: string,
  ): Promise<Record<string, string>> => {
    if (testEntries[name]) {
      return testEntries[name];
    }
    const { include, exclude, includeSource, root } = context.projects.find(
      (p) => p.name === name,
    )!.normalizedConfig;

    const entries = await getTestEntries({
      include,
      exclude,
      root,
      fileFilters,
      includeSource,
    });

    testEntries[name] = entries;

    return entries;
  };

  const setupFiles = Object.fromEntries(
    context.projects.map((project) => {
      const {
        name: projectName,
        normalizedConfig: { setupFiles },
      } = project;

      return [projectName, getSetupFiles(setupFiles, rootPath)];
    }),
  );

  const rsbuildInstance = await prepareRsbuild(
    context,
    globTestSourceEntries,
    setupFiles,
  );

  const { close, getRsbuildStats } = await createRsbuildServer({
    globTestSourceEntries,
    normalizedConfig: context.normalizedConfig,
    setupFiles,
    rsbuildInstance,
    rootPath,
  });

  const returns = await Promise.all(
    context.projects.map(async (project) => {
      const { entries, setupEntries, assetFiles, sourceMaps } =
        await getRsbuildStats(project.name);

      const pool = await createPool({
        entries,
        sourceMaps,
        setupEntries,
        assetFiles,
        context: {
          ...context,
          ...project,
        },
      });

      const list = await pool.collectTests();

      await pool.close();

      return {
        list,
        sourceMaps,
      };
    }),
  );

  const list = returns.flatMap((r) => r.list);
  const sourceMaps = Object.assign({}, ...returns.map((r) => r.sourceMaps));

  const tests: Array<{
    file: string;
    name?: string;
    project?: string;
  }> = [];

  const traverseTests = (test: Test) => {
    if (['skip', 'todo'].includes(test.runMode)) {
      return;
    }

    if (test.type === 'case') {
      if (showProject) {
        tests.push({
          file: test.testPath,
          name: getTaskNameWithPrefix(test),
          project: test.project,
        });
      } else {
        tests.push({
          file: test.testPath,
          name: getTaskNameWithPrefix(test),
        });
      }
    } else {
      for (const child of test.tests) {
        traverseTests(child);
      }
    }
  };

  const hasError = list.some((file) => file.errors?.length);
  const showProject = context.projects.length > 1;

  if (hasError) {
    const { printError } = await import('../utils/error');
    process.exitCode = 1;
    for (const file of list) {
      const relativePath = relative(rootPath, file.testPath);

      if (file.errors?.length) {
        //  FAIL  tests/index.test.ts
        logger.log(`${color.bgRed(' FAIL ')} ${relativePath}`);

        for (const error of file.errors) {
          await printError(error, (name) => sourceMaps[name] || null, rootPath);
        }
      }
    }

    await close();
  }

  for (const file of list) {
    if (filesOnly) {
      if (showProject) {
        tests.push({
          file: file.testPath,
          project: file.project,
        });
      } else {
        tests.push({
          file: file.testPath,
        });
      }
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

  await close();
}
