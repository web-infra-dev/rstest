import { describe, expect, rs, test } from '@rstest/core';

describe('rs.mock with { spy: true } - CJS module', () => {
  test('spy mode works with CJS module default import', async () => {
    rs.doMock('../src/cjsModule.cts', { spy: true });

    // CJS modules should have default export added automatically
    const cjsModule = await import('../src/cjsModule.cts');

    // Default export should be the module itself
    expect(cjsModule.default).toBeDefined();
    expect(cjsModule.default.multiply).toBeDefined();
    expect(cjsModule.default.divide).toBeDefined();

    // Named exports should also work
    expect(cjsModule.multiply(2, 3)).toBe(6);
    expect(cjsModule.divide(6, 2)).toBe(3);

    // Should track calls
    expect(cjsModule.multiply).toHaveBeenCalledWith(2, 3);
    expect(cjsModule.divide).toHaveBeenCalledWith(6, 2);
  });
});

describe('rs.mock with { spy: true } - ESM module with default export', () => {
  test('spy mode preserves ESM default export', async () => {
    rs.doMock('../src/esmDefaultModule', { spy: true });

    const esmModule = await import('../src/esmDefaultModule');

    // Default export should be preserved
    expect(esmModule.default).toBeDefined();
    expect(esmModule.default.name).toBe('calculator');

    // Named exports should work
    expect(esmModule.add(1, 2)).toBe(3);
    expect(esmModule.subtract(5, 3)).toBe(2);

    // Should track calls
    expect(esmModule.add).toHaveBeenCalledWith(1, 2);
    expect(esmModule.subtract).toHaveBeenCalledWith(5, 3);
  });

  test('spy mode allows mocking default export methods', async () => {
    rs.doMock('../src/esmDefaultModule', { spy: true });

    const esmModule = await import('../src/esmDefaultModule');

    // Can mock named exports
    rs.mocked(esmModule.add).mockReturnValueOnce(100);
    expect(esmModule.add(1, 2)).toBe(100);
    expect(esmModule.add(1, 2)).toBe(3); // Back to original
  });
});
