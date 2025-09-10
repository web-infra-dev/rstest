import { join } from 'pathe';
import { prepareRsbuild } from '../../src/core/rsbuild';
import type { RstestContext } from '../../src/types';

process.env.DEBUG = 'false';

const rootPath = join(__dirname, '../..');

describe('prepareRsbuild', () => {
  it('should generate rspack config correctly (jsdom)', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {},
          tools: {},
          testEnvironment: 'jsdom',
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: 'jsdom',
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly (node)', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {},
          tools: {},
          testEnvironment: 'node',
          isolate: true,
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: 'node',
              isolate: true,
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
  });

  it('should generate rspack config correctly with projects', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: 'jsdom',
            },
          },
          {
            name: 'test-node',
            rootPath,
            environmentName: 'test-node',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {},
              output: {},
              tools: {},
              testEnvironment: 'node',
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(bundlerConfigs[0]).toMatchSnapshot();
    expect(bundlerConfigs[1]).toMatchSnapshot();
  });

  it('should generate swc config correctly with user customize', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        rootPath,
        normalizedConfig: {
          root: rootPath,
          name: 'test',
          plugins: [],
          resolve: {},
          source: {
            decorators: {
              version: 'legacy',
            },
            include: [/node_modules[\\/]query-string[\\/]/],
          },
          output: {},
          tools: {},
        },
        projects: [
          {
            name: 'test',
            rootPath,
            environmentName: 'test',
            normalizedConfig: {
              plugins: [],
              resolve: {},
              source: {
                decorators: {
                  version: 'legacy',
                },
                include: [/node_modules[\\/]query-string[\\/]/],
              },
              output: {},
              tools: {},
            },
          },
        ],
      } as unknown as RstestContext,
      async () => ({}),
      {},
    );
    expect(rsbuildInstance).toBeDefined();
    const {
      origin: { bundlerConfigs },
    } = await rsbuildInstance.inspectConfig();

    expect(
      bundlerConfigs[0]?.module?.rules?.filter(
        (rule) =>
          rule &&
          typeof rule === 'object' &&
          rule.test &&
          rule.test instanceof RegExp &&
          rule.test.test('a.js'),
      ),
    ).toMatchSnapshot();
  });
});
