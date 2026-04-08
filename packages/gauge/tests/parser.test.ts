import { describe, it, expect } from '@rstest/core';
import { parseSpec, parseConcepts, expandConcepts } from '../src/parser';

describe('parseSpec', () => {
  it('parses a simple spec', () => {
    const spec = parseSpec(`
# Basic Execution

## Single test passes

* Create file "basic.test.ts" with "test('hello', () => { expect(1).toBe(1) })"
* Run rstest
* Should have "1" tests passed
* Exit code should be "0"
    `);

    expect(spec.name).toBe('Basic Execution');
    expect(spec.scenarios).toHaveLength(1);
    expect(spec.scenarios[0].name).toBe('Single test passes');
    expect(spec.scenarios[0].steps).toHaveLength(4);
    expect(spec.scenarios[0].steps[0].text).toBe(
      'Create file "basic.test.ts" with "test(\'hello\', () => { expect(1).toBe(1) })"',
    );
  });

  it('parses multiple scenarios', () => {
    const spec = parseSpec(`
# Test Suite

## Scenario A

* Step one
* Step two

## Scenario B

* Step three
    `);

    expect(spec.name).toBe('Test Suite');
    expect(spec.scenarios).toHaveLength(2);
    expect(spec.scenarios[0].name).toBe('Scenario A');
    expect(spec.scenarios[0].steps).toHaveLength(2);
    expect(spec.scenarios[1].name).toBe('Scenario B');
    expect(spec.scenarios[1].steps).toHaveLength(1);
  });

  it('throws when no title is found', () => {
    expect(() => parseSpec('## No title\n* step')).toThrow(
      'Spec must have a title',
    );
  });

  it('ignores blank lines and non-step content', () => {
    const spec = parseSpec(`
# Spec

Some description text that should be ignored.

## Scenario

* Step one

Some more text.

* Step two
    `);

    expect(spec.scenarios[0].steps).toHaveLength(2);
  });
});

describe('parseConcepts', () => {
  it('parses a single concept', () => {
    const concepts = parseConcepts(`
# Create and run single file test with <content>

* Create file "test.test.ts" with <content>
* Run rstest
    `);

    expect(concepts).toHaveLength(1);
    expect(concepts[0].pattern).toBe(
      'Create and run single file test with <content>',
    );
    expect(concepts[0].paramNames).toEqual(['content']);
    expect(concepts[0].steps).toHaveLength(2);
    expect(concepts[0].steps[0]).toBe(
      'Create file "test.test.ts" with <content>',
    );
  });

  it('parses multiple concepts in one file', () => {
    const concepts = parseConcepts(`
# Concept A

* Step A1
* Step A2

# Concept B with <param>

* Step B1 using <param>
    `);

    expect(concepts).toHaveLength(2);
    expect(concepts[0].pattern).toBe('Concept A');
    expect(concepts[1].pattern).toBe('Concept B with <param>');
  });
});

describe('expandConcepts', () => {
  it('expands a concept into atomic steps', () => {
    const concepts = parseConcepts(`
# Create and run single file test with <content>

* Create file "test.test.ts" with <content>
* Run rstest
    `);

    const steps = [
      {
        text: 'Create and run single file test with "test(\'hi\', () => {})"',
      },
      { text: 'Should have "1" tests passed' },
    ];

    const expanded = expandConcepts(steps, concepts);

    expect(expanded).toHaveLength(3);
    expect(expanded[0].text).toBe(
      'Create file "test.test.ts" with "test(\'hi\', () => {})"',
    );
    expect(expanded[1].text).toBe('Run rstest');
    expect(expanded[2].text).toBe('Should have "1" tests passed');
  });

  it('passes through steps that do not match any concept', () => {
    const steps = [{ text: 'Run rstest' }];
    const expanded = expandConcepts(steps, []);
    expect(expanded).toEqual([{ text: 'Run rstest' }]);
  });

  it('throws on circular concept reference', () => {
    const concepts = parseConcepts(`
# Concept A

* Concept B

# Concept B

* Concept A
    `);

    // "Concept A" and "Concept B" have no params, so they match as plain text
    const steps = [{ text: 'Concept A' }];
    expect(() => expandConcepts(steps, concepts)).toThrow('max depth');
  });
});
