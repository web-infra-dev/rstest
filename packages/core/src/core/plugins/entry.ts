import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import path from 'pathe';
import type { RstestContext } from '../../types';
import { castArray, getTempRstestOutputDirGlob } from '../../utils';
import type { TestEntryPathState } from './moduleCacheControl';

class TestFileWatchPlugin {
  private readonly contextToWatch: string | null = null;

  constructor(contextToWatch: string) {
    this.contextToWatch = contextToWatch;
  }

  apply(compiler: Rspack.Compiler) {
    compiler.hooks.afterCompile.tap(
      'Rstest:TestFileWatchPlugin',
      (compilation) => {
        if (this.contextToWatch === null) {
          return;
        }

        const contextDep = compilation.contextDependencies;
        if (!contextDep.has(this.contextToWatch)) {
          contextDep.add(this.contextToWatch);
        }
      },
    );
  }
}

const rstestVirtualEntryFlag = 'rstest-virtual-entry-';
const rerunTriggers = new Map<string, () => void>();
const configuredWatchConfigs = new WeakMap<object, Set<string>>();

export const triggerRerun = (): boolean => {
  let hasTrigger = false;
  for (const trigger of rerunTriggers.values()) {
    hasTrigger = true;
    trigger();
  }
  return hasTrigger;
};

export const pluginEntryWatch: (params: {
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
  testEntryPathState?: TestEntryPathState;
  isWatch: boolean;
  configFilePath?: string;
}) => RsbuildPlugin = ({
  isWatch,
  globTestSourceEntries,
  setupFiles,
  globalSetupFiles,
  context,
  testEntryPathState,
}) => ({
  name: 'rstest:entry-watch',
  setup: (api) => {
    api.onCloseDevServer(() => {
      rerunTriggers.clear();
    });

    const outputDistPathRoot = context.normalizedConfig.output.distPath.root;
    const getSourceEntries = async (environmentName: string) => {
      const sourceEntries = await globTestSourceEntries(environmentName);
      if (testEntryPathState) {
        testEntryPathState.set(
          environmentName,
          new Set(Object.values(sourceEntries).map(path.normalize)),
        );
      }
      return sourceEntries;
    };

    api.modifyRspackConfig(async (config, { environment, rspack }) => {
      if (isWatch) {
        let configuredEnvironments = configuredWatchConfigs.get(config);
        if (!configuredEnvironments) {
          configuredEnvironments = new Set();
          configuredWatchConfigs.set(config, configuredEnvironments);
        }
        if (configuredEnvironments.has(environment.name)) {
          return;
        }
        configuredEnvironments.add(environment.name);

        config.plugins.push(new TestFileWatchPlugin(environment.config.root));
        config.entry = async () => {
          const sourceEntries = await getSourceEntries(environment.name);
          return {
            ...sourceEntries,
            ...setupFiles[environment.name],
            ...(globalSetupFiles?.[environment.name] || {}),
          };
        };

        const virtualEntryPath = path.join(
          environment.config.root,
          `${rstestVirtualEntryFlag}${environment.name}.js`,
        );
        let virtualEntryVersion = 0;
        const getVirtualEntryContent = () =>
          `export const virtualEntry = ${virtualEntryVersion};`;
        const virtualModulesPlugin =
          new rspack.experiments.VirtualModulesPlugin({
            [virtualEntryPath]: getVirtualEntryContent(),
          });

        config.plugins.push({
          apply(compiler: Rspack.Compiler) {
            virtualModulesPlugin.apply(compiler);
            rerunTriggers.set(environment.name, () => {
              virtualEntryVersion += 1;
              virtualModulesPlugin.writeModule(
                virtualEntryPath,
                getVirtualEntryContent(),
              );
            });
          },
        });

        config.watchOptions ??= {};
        config.watchOptions.aggregateTimeout = 100;
        // TODO: rspack should support `(string | RegExp)[]` type
        // https://github.com/web-infra-dev/rspack/issues/10596
        config.watchOptions.ignored = castArray(
          config.watchOptions.ignored || [],
        ) as string[];

        if (config.watchOptions.ignored.length === 0) {
          config.watchOptions.ignored.push(
            // apply default ignored patterns
            ...['**/.git', '**/node_modules'],
          );
        }

        config.watchOptions.ignored.push(
          getTempRstestOutputDirGlob(outputDistPathRoot),
          context.normalizedConfig.coverage.reportsDirectory,
          // ignore global setup files since they are only run once
          ...Object.values(globalSetupFiles?.[environment.name] || {}),
          '**/*.snap',
        );

        config.experiments ??= {};
        config.experiments.nativeWatcher ??= true;

        const configFilePath = context.projects.find(
          (project) => project.environmentName === environment.name,
        )?.configFilePath;

        if (configFilePath) {
          config.watchOptions.ignored.push(configFilePath);
        }
      } else {
        // watch false seems not effect when rspack.watch()
        config.watch = false;
        config.watchOptions ??= {};
        config.watchOptions.ignored = '**/**';

        const sourceEntries = await getSourceEntries(environment.name);
        config.entry = {
          ...setupFiles[environment.name],
          ...(globalSetupFiles?.[environment.name] || {}),
          ...sourceEntries,
        };
      }
    });
  },
});
