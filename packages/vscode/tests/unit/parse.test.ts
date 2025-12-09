import fs from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from '@rstest/core';
import { parseTestFile, type Range } from '../../src/parserTest';

describe('parseTestFile', () => {
  it('should detect nested describe and test blocks', () => {
    const code = `
      describe('outer', () => {
        it('inner test', () => {});
        test('another inner test', () => {});
        describe('inner describe', () => {
          test('deeply nested test', () => {});
        });
      });
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    // The order of discovery is not guaranteed to be in source order, so we sort.
    tests.sort((a, b) => a.name.localeCompare(b.name));

    expect(tests.map((t) => t.name)).toEqual([
      'another inner test',
      'deeply nested test',
      'inner describe',
      'inner test',
      'outer',
    ]);

    expect(tests.map((t) => t.type)).toEqual([
      'test',
      'test',
      'describe',
      'it',
      'describe',
    ]);
  });

  it('should handle template literals in test names', () => {
    const code = `
      const a = 'a';
      describe(\`outer \${a}\`, () => {
        it('inner test', () => {});
      });
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));

    // biome-ignore lint/suspicious/noTemplateCurlyInString: use $ here.
    expect(tests.map((t) => t.name)).toEqual(['inner test', 'outer ${...}']);
  });

  it('should detect .only, .skip and .todo variants', () => {
    const code = `
      describe.skip('skipped describe', () => {
        it('inner', () => {});
      });
      test.only('focused test', () => {});
      test["only"]('computed only', () => {});
      test.todo('has todo');
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));

    expect(tests.map((t) => t.name)).toEqual([
      'computed only',
      'focused test',
      'has todo',
      'inner',
      'skipped describe',
    ]);
    expect(tests.map((t) => t.type)).toEqual([
      'test',
      'test',
      'test',
      'it',
      'describe',
    ]);
  });

  it('should detect suite blocks', () => {
    const code = `
      suite('root suite', () => {
        test('child test', () => {});
      });
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));

    expect(tests.map((t) => t.name)).toEqual(['child test', 'root suite']);
    expect(tests.map((t) => t.type)).toEqual(['test', 'suite']);
  });

  it('should mark non-literal or missing names as "unnamed test"', () => {
    const code = `
      const title = getTitle();
      function getTitle() { return 'x'; }
      test(title as any, () => {});
      it(123 as any, () => {});
      describe(() => {}, () => {});
      suite((() => 'x') as any, () => {});
      test(() => {});
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    expect(tests.length).toBe(5);
    expect(tests.every((t) => t.name === 'unnamed test')).toBe(true);
  });

  it('should handle complex template literals with multiple expressions', () => {
    const code = `
      const a = 1, b = 2;
      test(\`prefix \${a} middle \${b} suffix\`, () => {});
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        _testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: 'test' });
      },
    });

    expect(tests.map((t) => t.name)).toEqual([
      // biome-ignore lint/suspicious/noTemplateCurlyInString: use $ here.
      'prefix ${...} middle ${...} suffix',
    ]);
  });

  it('should parse files with TSX/JSX content in callbacks', () => {
    const code = `
      describe('jsx', () => {
        it('renders', () => {
          const el = <div>Hello</div>;
        });
      });
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));

    expect(tests.map((t) => t.name)).toEqual(['jsx', 'renders']);
    expect(tests.map((t) => t.type)).toEqual(['describe', 'it']);
  });

  it('should ignore non-test-like calls', () => {
    const code = `
      foo('bar', () => {});
      something.test('not recognized', () => {});
      console.log('not a test');
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (
        _range: Range,
        name: string,
        testType: 'test' | 'it' | 'describe' | 'suite',
      ) => {
        tests.push({ name, type: testType });
      },
    });

    expect(tests.length).toBe(0);
  });

  it('should compute reasonable ranges for calls', () => {
    const code = `describe("top", () => {\n  it('child', () => {})\n});`;

    const results: { name: string; type: string; range: Range }[] = [];
    parseTestFile(code, {
      onTest: (range: Range, name: string, testType) => {
        results.push({ name, type: testType, range });
      },
    });

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.top.range.startLine).toBe(0);
    expect(byName.child.range.startLine).toBe(1);
  });

  it('should compute range correctly with chinese characters', () => {
    const code = fs.readFileSync(join(__dirname, './test.txt'), 'utf-8');

    const results: { name: string; type: string; range: Range }[] = [];
    parseTestFile(code, {
      onTest: (range: Range, name: string, testType) => {
        results.push({ name, type: testType, range });
      },
    });

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.outer.range.startLine).toBe(5);
    expect(byName.outer.range.endLine).toBe(8);
    expect(byName.inner.range.startLine).toBe(6);
  });

  it('should handle quotes and escaped characters', () => {
    const code = `
      describe('he said "hi"', () => {
        it('emoji 🚀', () => {});
      });
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (_range: Range, name: string, testType) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));
    expect(tests.map((t) => t.name)).toEqual(['emoji 🚀', 'he said "hi"']);
  });

  it('should handle comments and whitespace around arguments', () => {
    const code = `
      test /* c1 */ ( /* c2 */ 'spaced' /* c3 */ , () => {} );
      it/*a*/(/*b*/"also spaced"/*c*/,() => {});
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (_range: Range, name: string, testType) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));
    expect(tests.map((t) => t.name)).toEqual(['also spaced', 'spaced']);
  });

  it('should detect describe without a callback', () => {
    const code = `
      describe('name only');
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (_range: Range, name: string, testType) => {
        tests.push({ name, type: testType });
      },
    });

    expect(tests).toEqual([{ name: 'name only', type: 'describe' }]);
  });

  it('should find tests inside control flow blocks', () => {
    const code = `
      if (true) {
        describe('cond', () => {
          for (const _ of [1]) {
            test('inside loop', () => {});
          }
        });
      }
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (_range: Range, name: string, testType) => {
        tests.push({ name, type: testType });
      },
    });

    tests.sort((a, b) => a.name.localeCompare(b.name));
    expect(tests.map((t) => t.name)).toEqual(['cond', 'inside loop']);
    expect(tests.map((t) => t.type)).toEqual(['describe', 'test']);
  });

  it('should detect suite.skip variant', () => {
    const code = `
      suite.skip('skipped suite', () => {});
    `;

    const tests: { name: string; type: string }[] = [];
    parseTestFile(code, {
      onTest: (_range: Range, name: string, testType) => {
        tests.push({ name, type: testType });
      },
    });

    expect(tests).toEqual([{ name: 'skipped suite', type: 'suite' }]);
  });
});
