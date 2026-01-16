import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
import type { RstestContext } from '../../types';
import { castArray, TEMP_RSTEST_OUTPUT_DIR_GLOB } from '../../utils';

class TestFileWatchPlugin {
  private contextToWatch: string | null = null;

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
        // FIXME: Temporarily default to 5 to debounce rerun in watch mode.
        config.watchOptions.aggregateTimeout = 5;
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
          TEMP_RSTEST_OUTPUT_DIR_GLOB,
          context.normalizedConfig.coverage.reportsDirectory,
          // ignore global setup files since they are only run once
          ...Object.values(globalSetupFiles?.[environment.name] || {}),
          '**/*.snap',
          // ignore midscene output directory to prevent infinite reload loop
          // when Midscene generates report files during AI operations
          '**/midscene_run/**',
        );

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
