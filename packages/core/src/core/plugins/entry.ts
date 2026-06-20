import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import { castArray, getTempRstestOutputDirGlob } from '../../utils';

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
  context: RstestContext;
  globTestSourceEntries: (name: string) => Promise<Record<string, string>>;
  setupFiles: Record<string, Record<string, string>>;
  globalSetupFiles: Record<string, Record<string, string>>;
  isWatch: boolean;
  configFilePath?: string;
}) => RsbuildPlugin = ({
  isWatch,
  globTestSourceEntries,
  setupFiles,
  globalSetupFiles,
  context,
}) => ({
  name: 'rstest:entry-watch',
  setup: (api) => {
    const outputDistPathRoot = context.normalizedConfig.output.distPath.root;
    api.modifyRspackConfig(async (config, { environment }) => {
      if (isWatch) {
        config.plugins.push(new TestFileWatchPlugin(environment.config.root));
        config.entry = async () => {
          const sourceEntries = await globTestSourceEntries(environment.name);
          return {
            ...sourceEntries,
            ...setupFiles[environment.name],
            ...(globalSetupFiles?.[environment.name] || {}),
          };
        };

        config.watchOptions ??= {};
        // Default aggregate window for watch-mode rerun debouncing. On macOS
        // with the rspack native watcher this also needs to be long enough
        // for the FSEvent → vnode cache invalidation cycle to complete before
        // rspack stats the changed file (otherwise the rebuild reads stale
        // content and rstest reports "No test files need re-run"). 100 ms is
        // the minimum value that survives macos-14 GHA runners. User configs
        // can override via `tools.rspack.watchOptions`.
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
        config.experiments.nativeWatcher = true;

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

        const sourceEntries = await globTestSourceEntries(environment.name);
        config.entry = {
          ...setupFiles[environment.name],
          ...(globalSetupFiles?.[environment.name] || {}),
          ...sourceEntries,
        };
      }
    });
  },
});
