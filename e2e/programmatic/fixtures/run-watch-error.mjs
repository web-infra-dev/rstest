import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  `.watch-error-${process.pid}`,
);
const testFile = join(root, 'index.test.ts');
const source = (name) =>
  `import { it } from '@rstest/core'; it('${name}', () => {});`;
const cycles = [];
let watcher;
let resolveCycle;
let breakAssets = false;
await mkdir(root, { recursive: true });
await writeFile(testFile, source('initial'));

try {
  const rstest = await createRstest({
    cwd: root,
    config: {
      include: ['index.test.ts'],
      reporters: [],
      tools: {
        rspack(config, { appendPlugins }) {
          appendPlugins({
            apply(compiler) {
              compiler.hooks.thisCompilation.tap(
                'remove-rerun-assets',
                (compilation) => {
                  compilation.hooks.afterProcessAssets.tap(
                    'remove-rerun-assets',
                    () => {
                      if (breakAssets) {
                        // A broken build plugin leaves an entry without its emitted JS.
                        // Reading that entry's stats rejects inside executor.runCycle.
                        for (const asset of compilation.getAssets()) {
                          if (/\.m?js$/.test(asset.name))
                            compilation.deleteAsset(asset.name);
                        }
                      }
                    },
                  );
                },
              );
            },
          });
        },
      },
    },
  });
  watcher = await rstest.watch({
    onResult(result) {
      cycles.push({ status: result.status, errors: result.unhandledErrors });
      resolveCycle?.();
    },
  });
  for (const broken of [true, false]) {
    breakAssets = broken;
    let timer;
    const nextCycle = new Promise((resolve, reject) => {
      resolveCycle = resolve;
      timer = setTimeout(
        () => reject(new Error('Rerun result timed out')),
        20_000,
      );
    });
    try {
      await writeFile(testFile, source(broken ? 'broken build' : 'recovered'));
      await nextCycle;
    } finally {
      clearTimeout(timer);
    }
  }
  await watcher.close();
  console.log(`__RSTEST_API_RESULT__${JSON.stringify({ cycles })}__END__`);
} finally {
  await watcher?.close();
  await rm(root, { recursive: true, force: true });
}
