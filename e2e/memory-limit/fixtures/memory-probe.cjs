const { appendFileSync } = require('node:fs');
const { threadId } = require('node:worker_threads');

const memoryUsage = process.memoryUsage;
const record = (metric) => {
  appendFileSync(
    process.env.RSTEST_MEMORY_SAMPLE_LOG,
    `${process.pid}:${threadId}\t${metric}\n`,
  );
};

process.memoryUsage = Object.assign(
  () => {
    record('heapUsed');
    return memoryUsage();
  },
  {
    rss: () => {
      record('rss');
      return memoryUsage.rss();
    },
  },
);
