import type { RsbuildPlugin, Rspack } from '@rsbuild/core';

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
      } else {
        const sourceEntries = await globTestSourceEntries();
        config.entry = {
          ...sourceEntries,
          ...setupFiles,
        };
      }
    });
  },
});
