import { describe, it, expect } from '@rstest/core';
import { expandSpec } from '../src/expand';
import { StepRegistry } from '../src/registry';

function createTestRegistry(): StepRegistry {
  const registry = new StepRegistry();

  registry.register(
    'Create file <filename> with <content>',
    (filename, content) =>
      `fs.writeFileSync(path.join(tmpDir, ${JSON.stringify(filename)}), ${JSON.stringify(content)})`,
  );

  registry.register(
    'Run rstest',
    () => 'const result = await runRstest(tmpDir)',
  );

  registry.register(
    'Should have <count> tests passed',
    (count) => `expect(result.passed).toBe(${count})`,
  );

  registry.register(
    'Should have <count> tests failed',
    (count) => `expect(result.failed).toBe(${count})`,
  );

  registry.register(
    'Exit code should be <code>',
    (code) => `expect(result.exitCode).toBe(${code})`,
  );

  registry.register(
    'Failed tests should contain <testName>',
    (testName) =>
      `expect(result.failedTests).toContainEqual(expect.objectContaining({ name: ${JSON.stringify(testName)} }))`,
  );

  return registry;
}

describe('expandSpec', () => {
  it('expands the RFC example spec', () => {
    const registry = createTestRegistry();

    const result = expandSpec({
      spec: `
# Basic Execution

## Single test passes

* Create file "basic.test.ts" with "test('hello', () => { expect(1).toBe(1) })"
* Run rstest
* Should have "1" tests passed
* Exit code should be "0"

## Test failure gives non-zero exit code

* Create file "fail.test.ts" with "test('fail', () => { expect(1).toBe(2) })"
* Run rstest
* Should have "1" tests failed
* Exit code should be "1"
      `,
      registry,
    });

    expect(result.name).toBe('Basic Execution');
    expect(result.scenarios).toHaveLength(2);

    // First scenario
    const s1 = result.scenarios[0];
    expect(s1.name).toBe('Single test passes');
    expect(s1.fragments).toHaveLength(4);
    expect(s1.fragments[0].code).toBe(
      "fs.writeFileSync(path.join(tmpDir, \"basic.test.ts\"), \"test('hello', () => { expect(1).toBe(1) })\")",
    );
    expect(s1.fragments[1].code).toBe(
      'const result = await runRstest(tmpDir)',
    );
    expect(s1.fragments[2].code).toBe('expect(result.passed).toBe(1)');
    expect(s1.fragments[3].code).toBe('expect(result.exitCode).toBe(0)');

    // Second scenario
    const s2 = result.scenarios[1];
    expect(s2.name).toBe('Test failure gives non-zero exit code');
    expect(s2.fragments).toHaveLength(4);
    expect(s2.fragments[2].code).toBe('expect(result.failed).toBe(1)');
  });

  it('expands spec with concepts', () => {
    const registry = createTestRegistry();

    const result = expandSpec({
      spec: `
# Basic Execution

## Simple assertion

* Create and run single file test with "test('hello', () => { expect(true).toBe(true) })"
* Should have "1" tests passed
      `,
      registry,
      conceptFiles: [
        `
# Create and run single file test with <content>

* Create file "test.test.ts" with <content>
* Run rstest
        `,
      ],
    });

    // Concept expands to 2 steps + 1 assertion step = 3 total
    expect(result.scenarios[0].fragments).toHaveLength(3);
    expect(result.scenarios[0].fragments[0].pattern).toBe(
      'Create file <filename> with <content>',
    );
    expect(result.scenarios[0].fragments[1].pattern).toBe('Run rstest');
    expect(result.scenarios[0].fragments[2].pattern).toBe(
      'Should have <count> tests passed',
    );
  });

  it('produces JSON-serializable output', () => {
    const registry = createTestRegistry();

    const result = expandSpec({
      spec: `
# Serialization Test

## Scenario

* Run rstest
* Exit code should be "0"
      `,
      registry,
    });

    // Should round-trip through JSON without loss
    const json = JSON.stringify(result, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe('Serialization Test');
    expect(parsed.scenarios[0].fragments[0].code).toBe(
      'const result = await runRstest(tmpDir)',
    );
  });
});
