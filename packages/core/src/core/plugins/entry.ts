import type { RsbuildPlugin, Rspack } from '@rsbuild/core';
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

const rstestVirtualEntryFlag = 'rstest-virtual-entry-';

let rerunTrigger: (() => void) | null = null;

const registerRerunTrigger = (fn: () => void) => {
  rerunTrigger = fn;
};

export const triggerRerun = (): void => {
  rerunTrigger?.();
};

export const pluginEntryWatch: (params: {
  globTestSourceEntries: () => Promise<Record<string, string>>;
  setupFiles: Record<string, string>;
  isWatch: boolean;
  configFilePath?: string;
}) => RsbuildPlugin = ({
  isWatch,
  globTestSourceEntries,
  setupFiles,
  configFilePath,
}) => ({
  name: 'rstest:entry-watch',
  setup: (api) => {
    api.onCloseDevServer(() => {
      rerunTrigger = null;
    });

    api.modifyRspackConfig(async (config, { rspack }) => {
      if (isWatch) {
        // FIXME: inspect config will retrigger initConfig
        if (rerunTrigger) {
          return;
        }

        config.plugins.push(new TestFileWatchPlugin(api.context.rootPath));

        // Add virtual entry to trigger recompile
        const virtualEntryName = `${rstestVirtualEntryFlag}${config.name!}.js`;
        const virtualEntryPath = `${config.context!}/${virtualEntryName}`;

        const virtualModulesPlugin =
          new rspack.experiments.VirtualModulesPlugin({
            [virtualEntryPath]: `export const virtualEntry = ${Date.now()}`,
          });

        registerRerunTrigger(() =>
          virtualModulesPlugin.writeModule(
            virtualEntryPath,
            `export const virtualEntry = ${Date.now()}`,
          ),
        );

        config.experiments ??= {};
        config.experiments.nativeWatcher = true;

        config.plugins.push(virtualModulesPlugin);

        config.entry = async () => {
          const sourceEntries = await globTestSourceEntries();
          return {
            ...sourceEntries,
            ...setupFiles,
            [virtualEntryPath]: virtualEntryPath,
          };
        };

        config.watchOptions ??= {};
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
          '**/*.snap',
        );

        if (configFilePath) {
          config.watchOptions.ignored.push(configFilePath);
        }
      } else {
        // watch false seems not effect when rspack.watch()
        config.watch = false;
        config.watchOptions ??= {};
        config.watchOptions.ignored = '**/**';

        const sourceEntries = await globTestSourceEntries();
        config.entry = {
          ...setupFiles,
          ...sourceEntries,
        };
      }
    });
  },
});
