import { describe, it, expect } from '@rstest/core';
import { StepRegistry, patternToRegex } from '../src/registry';

describe('patternToRegex', () => {
  it('converts pattern with no params', () => {
    const { regex, paramNames } = patternToRegex('Run rstest');
    expect(paramNames).toEqual([]);
    expect(regex.test('Run rstest')).toBe(true);
    expect(regex.test('Run something else')).toBe(false);
  });

  it('converts pattern with single param', () => {
    const { regex, paramNames } = patternToRegex(
      'Should have <count> tests passed',
    );
    expect(paramNames).toEqual(['count']);
    const m = 'Should have "3" tests passed'.match(regex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('3');
  });

  it('converts pattern with multiple params', () => {
    const { regex, paramNames } = patternToRegex(
      'Create file <filename> with <content>',
    );
    expect(paramNames).toEqual(['filename', 'content']);
    const m = 'Create file "test.ts" with "console.log(1)"'.match(regex);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('test.ts');
    expect(m![2]).toBe('console.log(1)');
  });

  it('escapes regex special characters in literal parts', () => {
    const { regex } = patternToRegex('Exit code should be (0)');
    expect(regex.test('Exit code should be (0)')).toBe(true);
    expect(regex.test('Exit code should be 0')).toBe(false);
  });

  it('handles params with quotes inside values', () => {
    const { regex } = patternToRegex('Create file <filename> with <content>');
    const m =
      "Create file \"basic.test.ts\" with \"test('hello', () => {})\"".match(
        regex,
      );
    expect(m).not.toBeNull();
    expect(m![1]).toBe('basic.test.ts');
    expect(m![2]).toBe("test('hello', () => {})");
  });
});

describe('StepRegistry', () => {
  it('registers and matches steps', () => {
    const registry = new StepRegistry();
    registry.register('Run rstest', () => 'const result = await runRstest(tmpDir)');

    const result = registry.match('Run rstest');
    expect(result).not.toBeNull();
    expect(result!.definition.pattern).toBe('Run rstest');
    expect(result!.args).toEqual({});
  });

  it('returns null for unmatched steps', () => {
    const registry = new StepRegistry();
    registry.register('Run rstest', () => 'code');

    expect(registry.match('Run something else')).toBeNull();
  });

  it('expands step with no params', () => {
    const registry = new StepRegistry();
    registry.register(
      'Run rstest',
      () => 'const result = await runRstest(tmpDir)',
    );

    const result = registry.expand('Run rstest');
    expect(result.code).toBe('const result = await runRstest(tmpDir)');
    expect(result.pattern).toBe('Run rstest');
    expect(result.args).toEqual({});
  });

  it('expands step with params', () => {
    const registry = new StepRegistry();
    registry.register(
      'Should have <count> tests passed',
      (count) => `expect(result.passed).toBe(${count})`,
    );

    const result = registry.expand('Should have "5" tests passed');
    expect(result.code).toBe('expect(result.passed).toBe(5)');
    expect(result.args).toEqual({ count: '5' });
  });

  it('expands step with multiple params', () => {
    const registry = new StepRegistry();
    registry.register(
      'Create file <filename> with <content>',
      (filename, content) =>
        `fs.writeFileSync(path.join(tmpDir, ${JSON.stringify(filename)}), ${JSON.stringify(content)})`,
    );

    const result = registry.expand(
      'Create file "basic.test.ts" with "expect(1).toBe(1)"',
    );
    expect(result.code).toBe(
      'fs.writeFileSync(path.join(tmpDir, "basic.test.ts"), "expect(1).toBe(1)")',
    );
    expect(result.args).toEqual({
      filename: 'basic.test.ts',
      content: 'expect(1).toBe(1)',
    });
  });

  it('throws on unmatched expand', () => {
    const registry = new StepRegistry();
    expect(() => registry.expand('Unknown step')).toThrow(
      'No matching step definition for: "Unknown step"',
    );
  });

  it('lists all registered patterns', () => {
    const registry = new StepRegistry();
    registry.register('Step A', () => 'a');
    registry.register('Step B', () => 'b');

    expect(registry.getPatterns()).toEqual(['Step A', 'Step B']);
  });
});
