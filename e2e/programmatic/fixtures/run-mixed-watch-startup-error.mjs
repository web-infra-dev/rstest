import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRstest } from '@rstest/core/api';

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  `.mixed-watch-${process.pid}`,
);
await mkdir(root, { recursive: true });
for (const name of ['node', 'browser']) {
  await writeFile(
    join(root, `${name}.test.ts`),
    `import { it } from '@rstest/core'; it('${name}', () => {});`,
  );
}

let nodeServerClosed = false;
let watcher;
let rejection;
try {
  const rstest = await createRstest({
    cwd: root,
    config: {
      reporters: [],
      projects: [
        {
          name: 'node',
          include: ['node.test.ts'],
          plugins: [
            {
              name: 'observe-node-server-close',
              setup(api) {
                api.onCloseDevServer(() => {
                  nodeServerClosed = true;
                });
              },
            },
          ],
        },
        {
          name: 'browser',
          include: ['browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: 'playwright',
            port: Number(process.argv[2]),
            providerOptions: {
              launch: process.env.CI ? { channel: 'chrome' } : {},
              context: {
                storageState: join(root, 'missing-browser-state.json'),
              },
            },
          },
        },
      ],
    },
  });
  try {
    watcher = await rstest.watch();
  } catch (error) {
    rejection = error.message;
  }
  console.log(
    `__RSTEST_API_RESULT__${JSON.stringify({ rejection, nodeServerClosed })}__END__`,
  );
} finally {
  await watcher?.close();
  await rm(root, { recursive: true, force: true });
}
