import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { Bench } from 'tinybench';
import {
  getTestStatus,
  hasOnlyTest,
} from '../packages/core/src/runtime/runner/task';
import {
  formatName,
  parseTemplateTable,
} from '../packages/core/src/runtime/util';
// Import utility functions from the core package source
import {
  castArray,
  formatRootStr,
  getAbsolutePath,
  getTaskNameWithPrefix,
  isPlainObject,
  prettyTime,
  serializableConfig,
  slash,
  undoSerializableConfig,
} from '../packages/core/src/utils/helper';
import { getShardedFiles } from '../packages/core/src/utils/shard';
import {
  filterFiles,
  formatTestEntryName,
} from '../packages/core/src/utils/testFiles';

// --- Test data setup ---

const testFiles = Array.from(
  { length: 200 },
  (_, i) => `/project/src/tests/module${i}.test.ts`,
);
const filters = ['module1', 'module5', 'module10'];
const projectDir = '/project';

const shardFiles = Array.from({ length: 100 }, (_, i) => ({
  testPath: `/project/tests/test${i}.ts`,
}));

const testResults: Array<{
  testId: string;
  status: 'pass' | 'fail' | 'skip' | 'todo';
  parentNames: string[];
  name: string;
  testPath: string;
  project: string;
}> = [
  ...Array.from({ length: 40 }, (_, i) => ({
    testId: `${i}`,
    status: 'pass' as const,
    parentNames: ['suite1'],
    name: `test ${i}`,
    testPath: '/test.ts',
    project: 'default',
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    testId: `${40 + i}`,
    status: 'fail' as const,
    parentNames: ['suite2'],
    name: `failing test ${i}`,
    testPath: '/test.ts',
    project: 'default',
  })),
  ...Array.from({ length: 5 }, (_, i) => ({
    testId: `${45 + i}`,
    status: 'skip' as const,
    parentNames: [],
    name: `skipped test ${i}`,
    testPath: '/test.ts',
    project: 'default',
  })),
];

const testSuiteTests: Array<{
  type: 'case';
  runMode: 'run' | 'only' | 'skip' | 'todo';
  name: string;
  testId: string;
  parentNames: string[];
  testPath: string;
}> = [
  {
    type: 'case',
    runMode: 'run',
    name: 'test1',
    testId: '1',
    parentNames: [],
    testPath: '/t.ts',
  },
  {
    type: 'case',
    runMode: 'run',
    name: 'test2',
    testId: '2',
    parentNames: [],
    testPath: '/t.ts',
  },
  {
    type: 'case',
    runMode: 'only',
    name: 'test3',
    testId: '3',
    parentNames: [],
    testPath: '/t.ts',
  },
  {
    type: 'case',
    runMode: 'run',
    name: 'test4',
    testId: '4',
    parentNames: [],
    testPath: '/t.ts',
  },
];

// --- Benchmark setup ---

const bench = withCodSpeed(new Bench({ time: 100 }));

// Helper utilities
bench.add('slash - normalize backslashes', () => {
  slash('C:\\Users\\test\\project\\src\\file.ts');
  slash('/already/forward/slashes');
  slash('mixed\\path/with\\both/types');
});

bench.add('prettyTime - format milliseconds', () => {
  prettyTime(50);
  prettyTime(1500);
  prettyTime(65000);
  prettyTime(125500);
  prettyTime(0.5);
});

bench.add('formatRootStr - resolve root directory', () => {
  formatRootStr('<rootDir>/src/tests', '/workspace/project');
  formatRootStr('/absolute/path/tests', '/workspace/project');
  formatRootStr('<rootDir>/nested/<rootDir>/path', '/workspace/project');
});

bench.add('getAbsolutePath - resolve paths', () => {
  getAbsolutePath('/base', 'relative/path.ts');
  getAbsolutePath('/base', '/absolute/path.ts');
  getAbsolutePath('/workspace/project', './src/index.ts');
});

bench.add('castArray - normalize to array', () => {
  castArray(undefined);
  castArray('single');
  castArray(['already', 'array']);
  castArray(42);
});

bench.add('isPlainObject - type checking', () => {
  isPlainObject({});
  isPlainObject({ a: 1, b: { c: 2 } });
  isPlainObject(null);
  isPlainObject([]);
  isPlainObject('string');
  isPlainObject(new Date());
});

bench.add('getTaskNameWithPrefix - format test names', () => {
  getTaskNameWithPrefix({
    name: 'test case',
    parentNames: ['suite1', 'suite2'],
  });
  getTaskNameWithPrefix({ name: 'simple test', parentNames: [] });
  getTaskNameWithPrefix({
    name: 'deeply nested',
    parentNames: ['root', 'level1', 'level2', 'level3'],
  });
});

// Test file filtering
bench.add('filterFiles - filter 200 files with 3 filters', () => {
  filterFiles(testFiles, filters, projectDir);
});

bench.add('filterFiles - no filters (passthrough)', () => {
  filterFiles(testFiles, [], projectDir);
});

bench.add('formatTestEntryName - format entry names', () => {
  formatTestEntryName('../setup.ts');
  formatTestEntryName('src/tests/module.test.ts');
  formatTestEntryName('../../deeply/nested/path/to/test.spec.ts');
});

// Sharding
bench.add('getShardedFiles - shard 100 files into 4 shards', () => {
  getShardedFiles([...shardFiles], { count: 4, index: 1 });
});

bench.add('getShardedFiles - single shard (no-op)', () => {
  getShardedFiles([...shardFiles], { count: 1, index: 1 });
});

// Test name formatting
bench.add('formatName - printf-style format', () => {
  formatName('test %s + %d -> %i', ['hello', 42, 3], 0);
  formatName('values: %j', [{ a: 1, b: [2, 3] }], 0);
});

bench.add('formatName - template with object properties', () => {
  formatName('test $a with $b.c', { a: 'value', b: { c: 'nested' } }, 0);
  formatName('index %# item $name', { name: 'test' }, 5);
});

bench.add('formatName - index placeholders', () => {
  formatName('test index %# (one-based %$)', [1, 2, 3], 7);
});

// Template table parsing
bench.add('parseTemplateTable - parse 3-column table', () => {
  const strings = Object.assign(
    ['a | b | expected\n', ' | ', ' | ', '\n', ' | ', ' | ', ''],
    {
      raw: ['a | b | expected\n', ' | ', ' | ', '\n', ' | ', ' | ', ''],
    },
  ) as TemplateStringsArray;
  parseTemplateTable(strings, 1, 2, 3, 4, 5, 9);
});

// Test result status
bench.add('getTestStatus - evaluate 50 test results', () => {
  getTestStatus(testResults, 'pass');
});

bench.add('hasOnlyTest - check test tree for .only', () => {
  hasOnlyTest(testSuiteTests as any);
});

// Config serialization
bench.add('serializableConfig - serialize regex pattern', () => {
  serializableConfig({
    testNamePattern: /some-test-pattern/i,
  } as any);
});

bench.add('undoSerializableConfig - deserialize regex pattern', () => {
  undoSerializableConfig({
    testNamePattern: 'RSTEST_REGEXP:/some-test-pattern/i',
  } as any);
});

// Run benchmarks
(async () => {
  await bench.run();
  console.table(bench.table());
})();
