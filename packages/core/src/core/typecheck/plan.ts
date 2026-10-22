import type { InternalContext, InternalProjectContext } from '../../types';
import { getTestEntries, getShardedFiles } from '../../utils';

export interface TypecheckProject {
  project: InternalProjectContext;
  testPaths: string[];
}

export async function discoverTypeTests(
  context: InternalContext,
  projects: InternalProjectContext[],
  fileFilters: string[] | undefined = context.fileFilters,
): Promise<TypecheckProject[]> {
  if (
    context.command === 'watch' &&
    projects.some((project) => project.normalizedConfig.typecheck.enabled)
  )
    throw new Error(
      'Type testing does not support watch mode. Use "rstest run --typecheck" instead.',
    );
  const plans = await Promise.all(
    projects
      .filter((project) => project.normalizedConfig.typecheck.enabled)
      .map(async (project) => {
        const { root, exclude, typecheck, include, includeSource } =
          project.normalizedConfig;
        const testPaths = Object.values(
          await getTestEntries({
            rootPath: context.rootPath,
            projectRoot: root,
            include: typecheck.include,
            exclude: [...exclude.patterns, ...typecheck.exclude],
            includeSource: [],
            fileFilters,
          }),
        );
        if (!typecheck.only) {
          const runtime = new Set(
            Object.values(
              await getTestEntries({
                rootPath: context.rootPath,
                projectRoot: root,
                include,
                exclude: exclude.patterns,
                includeSource,
                fileFilters,
              }),
            ),
          );
          const overlap = testPaths.filter((file) => runtime.has(file));
          if (overlap.length)
            throw new Error(
              `Files cannot be both runtime and type tests in project "${project.name}":\n${overlap.join('\n')}`,
            );
        }
        return { project, testPaths };
      }),
  );
  const shard = context.normalizedConfig.shard;
  if (!shard) return plans;
  const runtimeFiles = (
    await Promise.all(
      projects
        .filter((project) => !project.normalizedConfig.typecheck.only)
        .map(async (project) => {
          const config = project.normalizedConfig;
          return Object.values(
            await getTestEntries({
              include: config.include,
              exclude: config.exclude.patterns,
              includeSource: config.includeSource,
              rootPath: context.rootPath,
              projectRoot: config.root,
              fileFilters,
            }),
          ).map((testPath) => ({ project, testPath }));
        }),
    )
  ).flat();
  const selected = new Set(
    getShardedFiles(
      [
        ...runtimeFiles,
        ...plans.flatMap(({ project, testPaths }) =>
          testPaths.map((testPath) => ({ project, testPath })),
        ),
      ],
      shard,
      context.rootPath,
    ).map(({ project, testPath }) => `${project.environmentName}:${testPath}`),
  );
  return plans.map(({ project, testPaths }) => ({
    project,
    testPaths: testPaths.filter((testPath) =>
      selected.has(`${project.environmentName}:${testPath}`),
    ),
  }));
}
