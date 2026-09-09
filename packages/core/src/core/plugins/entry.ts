import { rspack, type RsbuildPlugin, type Rspack } from '@rsbuild/core';
import path from 'pathe';
import type { InternalContext } from '../../types';
import { applyRstestWatchIgnored } from '../watchInvalidation';
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

export const pluginEntryWatch: (params: {
  context: InternalContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
  virtualModules: Record<string, Record<string, string>>;
  testEntryPathState?: TestEntryPathState;
  isWatch: boolean;
  configFilePath?: string;
}) => RsbuildPlugin = ({
  isWatch,
  globTestSourceEntries,
  setupFiles,
  globalSetupFiles,
  virtualModules,
  context,
  testEntryPathState,
}) => ({
  name: 'rstest:entry-watch',
  setup: (api) => {
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

    api.modifyRspackConfig(async (config, { environment }) => {
      const environmentVirtualModules = virtualModules[environment.name];
      if (
        environmentVirtualModules &&
        Object.keys(environmentVirtualModules).length
      ) {
        config.plugins.push(
          new rspack.experiments.VirtualModulesPlugin(
            environmentVirtualModules,
          ),
        );
      }

      if (isWatch) {
        config.plugins.push(new TestFileWatchPlugin(environment.config.root));
        config.entry = async () => {
          const sourceEntries = await getSourceEntries(environment.name);
          return {
            ...sourceEntries,
            ...setupFiles[environment.name],
            ...(globalSetupFiles?.[environment.name] || {}),
          };
        };

        const configFilePath = context.projects.find(
          (project) => project.environmentName === environment.name,
        )?.configFilePath;

        config.watchOptions = { ...config.watchOptions, aggregateTimeout: 100 };
        applyRstestWatchIgnored(
          config,
          context.normalizedConfig,
          configFilePath ? [configFilePath] : [],
        );

        config.experiments ??= {};
        config.experiments.nativeWatcher ??= true;
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
