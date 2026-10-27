import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { InternalContext, TestExecutor } from '../../types';
import type { TypecheckProject } from './plan';

export type TypecheckExecutor = TestExecutor &
  Required<Pick<TestExecutor, 'collect'>>;

export interface TypecheckHostModule {
  createTypecheckExecutor: (
    context: InternalContext,
    projects: TypecheckProject[],
  ) => TypecheckExecutor;
}

export async function loadTypecheckExecutor(
  context: InternalContext,
  projects: TypecheckProject[],
): Promise<TypecheckExecutor> {
  const bases = new Set([
    ...projects.map(
      ({ project }) => pathToFileURL(`${project.rootPath}/package.json`).href,
    ),
    pathToFileURL(`${process.cwd()}/package.json`).href,
    import.meta.url,
  ]);
  for (const base of bases) {
    const require = createRequire(base);
    let entry: string;
    let metadata: string;
    try {
      entry = require.resolve('@rstest/typecheck/internal');
      metadata = require.resolve('@rstest/typecheck/package.json');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'MODULE_NOT_FOUND'
      )
        continue;
      throw error;
    }
    const { version }: { version: string } = require(metadata);
    if (version !== RSTEST_VERSION) {
      throw new Error(
        `Version mismatch between @rstest/core (${RSTEST_VERSION}) and @rstest/typecheck (${version}). Install matching versions: npm install -D @rstest/typecheck@${RSTEST_VERSION}`,
      );
    }
    // The dynamically loaded package enforces this version-locked contract with satisfies.
    const module: TypecheckHostModule = await import(pathToFileURL(entry).href);
    return module.createTypecheckExecutor(context, projects);
  }
  throw new Error(
    `Type testing requires @rstest/typecheck. Install it with: npm install -D @rstest/typecheck@${RSTEST_VERSION}`,
  );
}
