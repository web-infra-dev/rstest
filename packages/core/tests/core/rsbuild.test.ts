import { prepareRsbuild } from '../../src/core/rsbuild';
import type { RstestContext } from '../../src/types';

describe('prepareRsbuild', () => {
  it('should generate rspack config correctly', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        normalizedConfig: {
          name: 'test',
          plugins: [],
          resolve: {},
          source: {},
          output: {},
          tools: {},
        },
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

  it('should generate swc config correctly with user customize', async () => {
    const rsbuildInstance = await prepareRsbuild(
      {
        normalizedConfig: {
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
