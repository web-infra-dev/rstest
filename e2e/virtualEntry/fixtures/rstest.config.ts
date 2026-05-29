import { rspack } from '@rsbuild/core';
import { defineConfig } from '@rstest/core';

const virtualTests: Record<string, string> = {
  'virtual/sum.test.ts': `
import { describe, expect, it } from '@rstest/core';

describe('virtual sum', () => {
  it('1 + 1 = 2', () => {
    expect(1 + 1).toBe(2);
  });
});
`,
  'virtual/diff.test.ts': `
import { describe, expect, it } from '@rstest/core';

describe('virtual diff', () => {
  it('3 - 1 = 2', () => {
    expect(3 - 1).toBe(2);
  });
});
`,
};

export default defineConfig({
  include: Object.keys(virtualTests),
  tools: {
    rspack: (_config, { appendPlugins }) => {
      appendPlugins(new rspack.experiments.VirtualModulesPlugin(virtualTests));
    },
  },
});
