import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it, rs } from '@rstest/core';
import { join, resolve } from 'pathe';
import { resolveProjects } from '../../src/cli/init';
import { loadConfig } from '../../src/config';
import { resolveRunnerInputs } from '../../src/core/config/resolveConfig';
import {
  type LoadProjectConfig,
  PROJECT_LOADER,
} from '../../src/projectLoader';
import type { RstestConfig } from '../../src/types';

type LoadContext = Parameters<LoadProjectConfig>[0];
type RootConfig = RstestConfig & { [PROJECT_LOADER]?: LoadProjectConfig };

let root: string;

const writeFile = (path: string, content: string) => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'rstest-project-loader-'));
  for (const pkg of ['a', 'b']) {
    writeFile(
      join(root, 'packages', pkg, 'package.json'),
      JSON.stringify({ name: `pkg-${pkg}` }),
    );
    writeFile(
      join(root, 'packages', pkg, 'rstest.config.mjs'),
      `export default { name: 'from-rstest-config-${pkg}' };`,
    );
    writeFile(join(root, 'packages', pkg, 'host.config.ts'), '');
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const hostFile = (pkg: string) => join(root, 'packages', pkg, 'host.config.ts');
const hostDep = (dirPath: string) => join(dirPath, 'host.shared.ts');

const createHostLoader = () =>
  rs.fn<LoadProjectConfig>(({ dirPath, filePath: configFile }) => {
    const filePath = configFile ?? join(dirPath, 'host.config.ts');
    return {
      content: { name: `host:${dirPath.split('/').pop()}`, globals: true },
      filePath,
      dependencies: [hostDep(dirPath)],
    };
  });

const sortedContexts = (loader: ReturnType<typeof createHostLoader>) =>
  loader.mock.calls
    .map(([ctx]) => ctx)
    .sort((x, y) => x.dirPath.localeCompare(y.dirPath));

describe('PROJECT_LOADER', () => {
  it('calls the loader once per directory target with `{ dirPath }`', async () => {
    const loader = createHostLoader();
    const projects = await resolveProjects({
      config: { projects: ['packages/*'] },
      root,
      options: {},
      projectLoader: loader,
    });

    expect(sortedContexts(loader)).toEqual<LoadContext[]>([
      { dirPath: join(root, 'packages/a') },
      { dirPath: join(root, 'packages/b') },
    ]);
    expect(projects.map((p) => p.config.name).sort()).toEqual([
      'host:a',
      'host:b',
    ]);
    expect(projects.map((p) => p.configFilePath).sort()).toEqual([
      hostFile('a'),
      hostFile('b'),
    ]);
    for (const project of projects) {
      const dirPath = join(root, 'packages', project.config.name!.slice(5));
      expect(project.config.globals).toBe(true);
      expect(resolve(project.config.root!)).toBe(dirPath);
      expect(project.configFileDependencies).toEqual([hostDep(dirPath)]);
    }
  });

  it('passes `{ dirPath, filePath }` for file targets', async () => {
    const loader = createHostLoader();
    const projects = await resolveProjects({
      config: { projects: ['packages/*/host.config.ts'] },
      root,
      options: {},
      projectLoader: loader,
    });

    expect(sortedContexts(loader)).toEqual<LoadContext[]>([
      { dirPath: join(root, 'packages/a'), filePath: hostFile('a') },
      { dirPath: join(root, 'packages/b'), filePath: hostFile('b') },
    ]);
    expect(projects).toHaveLength(2);
  });

  it('builds an empty project when the loader returns null, without falling back to rstest.config.*', async () => {
    const loader = rs.fn<LoadProjectConfig>(() => null);
    const projects = await resolveProjects({
      config: { projects: ['packages/a'] },
      root,
      options: {},
      projectLoader: loader,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.config.name).toBe('pkg-a');
    expect(projects[0]!.config.root).toBe(join(root, 'packages/a'));
    expect(projects[0]!.configFilePath).toBeUndefined();
    expect(projects[0]!.configFileDependencies).toEqual([]);
  });

  it('applies extends and CLI options to loader results', async () => {
    const loader = rs.fn<LoadProjectConfig>(({ dirPath }) => ({
      content: {
        name: 'with-extends',
        extends: { testEnvironment: 'jsdom', testTimeout: 1000 },
      },
      filePath: join(dirPath, 'host.config.ts'),
      dependencies: [],
    }));
    const projects = await resolveProjects({
      config: { projects: ['packages/a'] },
      root,
      options: { testTimeout: 3000 },
      projectLoader: loader,
    });

    expect(projects[0]!.config.testEnvironment).toBe('jsdom');
    expect(projects[0]!.config.testTimeout).toBe(3000);
  });

  it('uses the root loader for nested projects and ignores a loader on project configs', async () => {
    const nestedLoader = rs.fn<LoadProjectConfig>(() => null);
    const parentFile = join(root, 'packages', 'host.config.ts');
    const loader = rs.fn<LoadProjectConfig>(({ dirPath }) => {
      if (dirPath === join(root, 'packages')) {
        const content: RootConfig = {
          projects: ['./a', './b'],
          [PROJECT_LOADER]: nestedLoader,
        };
        return {
          content,
          filePath: parentFile,
          dependencies: ['/deps/parent-dep.ts'],
        };
      }
      return createHostLoader()({ dirPath });
    });

    const projects = await resolveProjects({
      config: { projects: ['packages'] },
      root,
      options: {},
      projectLoader: loader,
    });

    expect(nestedLoader).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledTimes(3);
    expect(projects.map((p) => p.config.name).sort()).toEqual([
      'host:a',
      'host:b',
    ]);
    for (const project of projects) {
      expect(project.configFileDependencies).toEqual([
        hostDep(join(root, 'packages', project.config.name!.slice(5))),
        '/deps/parent-dep.ts',
        parentFile,
      ]);
    }
  });

  it('keeps the loader when the root config has extends (API path)', async () => {
    const loader = createHostLoader();
    const content: RootConfig = {
      extends: { testTimeout: 1234 },
      projects: ['packages/a'],
      [PROJECT_LOADER]: loader,
    };

    const { projects } = await resolveRunnerInputs({
      result: { content, filePath: null, dependencies: [] },
      options: {},
      cwd: root,
    });

    expect(loader).toHaveBeenCalledTimes(1);
    expect(projects.map((p) => p.config.name)).toEqual(['host:a']);
  });

  it('keeps the loader when a root config file has extends (CLI path)', async () => {
    const dir = join(root, 'cli-root');
    writeFile(
      join(dir, 'rstest.config.mjs'),
      `const loader = ({ dirPath }) => ({ content: { name: 'cli:' + dirPath.split('/').pop() }, filePath: null, dependencies: [] });
export default {
  extends: { testTimeout: 4321 },
  projects: ['../packages/a'],
  [Symbol.for('rstest project loader')]: loader,
};`,
    );

    const { projects } = await resolveRunnerInputs({
      result: await loadConfig({ cwd: dir }),
      options: {},
      cwd: dir,
    });
    expect(projects.map((p) => p.config.name)).toEqual(['cli:a']);
  });
});
