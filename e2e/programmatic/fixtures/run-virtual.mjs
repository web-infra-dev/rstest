import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createRstest } from '@rstest/core/api';
import { rspack } from '@rsbuild/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

const virtualTests = {
  'virtual/programmatic.test.ts': `
import { describe, expect, it } from '@rstest/core';

describe('programmatic virtual', () => {
  it('inline + virtual entry works', () => {
    expect(2 * 3).toBe(6);
  });
});
`,
};

const rstest = await createRstest({
  cwd: __dirname,
  inlineConfig: {
    include: Object.keys(virtualTests),
    reporters: [],
    tools: {
      rspack: (_config, { appendPlugins }) => {
        appendPlugins(
          new rspack.experiments.VirtualModulesPlugin(virtualTests),
        );
      },
    },
  },
});
const result = await rstest.run();
await rstest.close();

console.log(
  `__RSTEST_API_RESULT__${JSON.stringify({
    ok: result.ok,
    stats: result.stats,
    files: result.files.map((f) => ({
      status: f.status,
      testName: f.testPath.split('/').slice(-2).join('/'),
    })),
  })}__END__`,
);
