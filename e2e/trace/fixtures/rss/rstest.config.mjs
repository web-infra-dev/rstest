import { fileURLToPath } from 'node:url';

export default {
  projects: process.env.TRACE_RSS_PROJECTS
    ? [
        { name: 'first', include: ['basic.test.ts', 'reuse.test.ts'] },
        { name: 'second', include: ['basic.test.ts'] },
      ]
    : undefined,
  pool: { type: 'threads', maxWorkers: 1 },
  reporters: [
    'dot',
    ...(process.env.TRACE_RSS_STAGE === 'coverage'
      ? [
          {
            onTestRunEnd({ coverage }) {
              if (!coverage) throw new Error('Expected collected coverage');
            },
          },
        ]
      : []),
  ],
  coverage: {
    enabled: process.env.TRACE_RSS_STAGE === 'coverage',
    provider: 'v8',
    include: ['src/**'],
    reporters: [
      fileURLToPath(new URL('./coverage-block.cjs', import.meta.url)),
    ],
  },
  tools: {
    rspack(config) {
      config.module.rules.push({
        test: /value\.ts$/,
        use: [fileURLToPath(new URL('./compile-block.cjs', import.meta.url))],
      });
    },
  },
};
