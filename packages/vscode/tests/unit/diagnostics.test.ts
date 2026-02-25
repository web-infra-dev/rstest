import { describe, expect, it, rs } from '@rstest/core';

const diagnosticsState = new Map<string, unknown[]>();
let clearCalls = 0;
let disposeCalls = 0;

rs.mock('vscode', () => {
  return {
    languages: {
      createDiagnosticCollection: () => ({
        set: (uri: { toString: () => string }, diagnostics: unknown[]) => {
          diagnosticsState.set(uri.toString(), diagnostics);
        },
        clear: () => {
          diagnosticsState.clear();
          clearCalls++;
        },
        dispose: () => {
          disposeCalls++;
        },
      }),
    },
  };
});

import { RstestDiagnostics } from '../../src/diagnostics';

const createUri = (path: string) =>
  ({
    toString: () => path,
  }) as any;

const createTestItem = (id: string) =>
  ({
    id,
  }) as any;

const createEntry = (path: string, message: string) =>
  ({
    uri: createUri(path),
    diagnostic: { message },
  }) as any;

describe('RstestDiagnostics', () => {
  it('should keep diagnostics for different test items with same id', () => {
    diagnosticsState.clear();
    clearCalls = 0;

    const diagnostics = new RstestDiagnostics();
    const itemA = createTestItem('duplicate-id');
    const itemB = createTestItem('duplicate-id');

    diagnostics.setForTest('project-a', itemA, [
      createEntry('file:///a.test.ts', 'error-a'),
    ]);
    diagnostics.setForTest('project-a', itemB, [
      createEntry('file:///a.test.ts', 'error-b'),
    ]);

    expect(diagnosticsState.get('file:///a.test.ts')).toEqual([
      { message: 'error-a' },
      { message: 'error-b' },
    ]);

    diagnostics.clearForTest('project-a', itemA);
    expect(diagnosticsState.get('file:///a.test.ts')).toEqual([
      { message: 'error-b' },
    ]);
  });

  it('should clear diagnostics for one project without affecting others', () => {
    diagnosticsState.clear();
    clearCalls = 0;

    const diagnostics = new RstestDiagnostics();
    diagnostics.setForTest('project-a', createTestItem('a'), [
      createEntry('file:///a.test.ts', 'error-a'),
      createEntry('file:///stale.test.ts', 'stale-a'),
    ]);
    diagnostics.setForTest('project-b', createTestItem('b'), [
      createEntry('file:///b.test.ts', 'error-b'),
    ]);

    diagnostics.clearForProject('project-a');

    expect(diagnosticsState.get('file:///a.test.ts')).toBeUndefined();
    expect(diagnosticsState.get('file:///stale.test.ts')).toBeUndefined();
    expect(diagnosticsState.get('file:///b.test.ts')).toEqual([
      { message: 'error-b' },
    ]);
  });

  it('should dispose collection safely', () => {
    diagnosticsState.clear();
    clearCalls = 0;
    disposeCalls = 0;

    const diagnostics = new RstestDiagnostics();
    diagnostics.setForTest('project-a', createTestItem('a'), [
      createEntry('file:///a.test.ts', 'error-a'),
    ]);
    diagnostics.dispose();

    expect(disposeCalls).toBe(1);
    expect(diagnosticsState.size).toBe(0);
    expect(clearCalls).toBeGreaterThan(0);
  });
});
