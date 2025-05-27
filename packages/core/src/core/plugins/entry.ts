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

export const pluginEntryWatch: (params: {
  globTestSourceEntries: () => Promise<Record<string, string>>;
  setupFiles: Record<string, string>;
  isWatch: boolean;
}) => RsbuildPlugin = ({ isWatch, globTestSourceEntries, setupFiles }) => ({
  name: 'rstest:entry-watch',
  setup: (api) => {
    api.modifyRspackConfig(async (config) => {
      if (isWatch) {
        config.plugins!.push(new TestFileWatchPlugin(api.context.rootPath));
        config.entry = async () => {
          const sourceEntries = await globTestSourceEntries();
          return {
            ...sourceEntries,
            ...setupFiles,
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

        config.watchOptions.ignored.push(TEMP_RSTEST_OUTPUT_DIR_GLOB);
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
