import { describe, expect, it } from '@rstest/core';
import { resolveOptions } from '../../src/reporter/md';

describe('resolveOptions', () => {
  describe('defaults', () => {
    it('returns default options when no input provided', () => {
      const result = resolveOptions();

      expect(result).toEqual({
        preset: 'normal',
        header: { env: true },
        reproduction: 'file+name',
        failures: { max: 50 },
        codeFrame: { enabled: true, linesAbove: 2, linesBelow: 2 },
        stack: 'top',
        candidateFiles: { enabled: true, max: 5 },
        console: {
          enabled: true,
          maxLogsPerTestPath: 10,
          maxCharsPerEntry: 500,
        },
        errors: { unhandled: true },
      });
    });
  });

  describe('preset: compact', () => {
    it('applies compact preset defaults', () => {
      const result = resolveOptions({ preset: 'compact' });

      expect(result.preset).toBe('compact');
      expect(result.console.enabled).toBe(false);
      expect(result.codeFrame.enabled).toBe(false);
      expect(result.failures.max).toBe(20);
      expect(result.stack).toBe('top');
    });
  });

  describe('preset: full', () => {
    it('applies full preset defaults', () => {
      const result = resolveOptions({ preset: 'full' });

      expect(result.preset).toBe('full');
      expect(result.stack).toBe('full');
      expect(result.console.maxLogsPerTestPath).toBe(200);
      expect(result.console.maxCharsPerEntry).toBe(5000);
      expect(result.failures.max).toBe(200);
      expect(result.codeFrame.linesAbove).toBe(3);
      expect(result.codeFrame.linesBelow).toBe(3);
    });
  });

  describe('header', () => {
    it('disables env when header is false', () => {
      const result = resolveOptions({ header: false });
      expect(result.header.env).toBe(false);
    });

    it('uses default when header is true', () => {
      const result = resolveOptions({ header: true });
      expect(result.header.env).toBe(true);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ header: { env: false } });
      expect(result.header.env).toBe(false);
    });
  });

  describe('reproduction', () => {
    it('disables reproduction when false', () => {
      const result = resolveOptions({ reproduction: false });
      expect(result.reproduction).toBe(false);
    });

    it('uses file mode', () => {
      const result = resolveOptions({ reproduction: 'file' });
      expect(result.reproduction).toBe('file');
    });

    it('uses file+name mode by default', () => {
      const result = resolveOptions({});
      expect(result.reproduction).toBe('file+name');
    });
  });

  describe('failures', () => {
    it('uses preset max when not specified', () => {
      const result = resolveOptions({ preset: 'compact' });
      expect(result.failures.max).toBe(20);
    });

    it('overrides preset max with user value', () => {
      const result = resolveOptions({
        preset: 'compact',
        failures: { max: 100 },
      });
      expect(result.failures.max).toBe(100);
    });
  });

  describe('codeFrame', () => {
    it('disables codeFrame when false', () => {
      const result = resolveOptions({ codeFrame: false });
      expect(result.codeFrame.enabled).toBe(false);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ codeFrame: { linesAbove: 5 } });
      expect(result.codeFrame.enabled).toBe(true);
      expect(result.codeFrame.linesAbove).toBe(5);
      expect(result.codeFrame.linesBelow).toBe(2);
    });

    it('uses preset values', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.codeFrame.linesAbove).toBe(3);
      expect(result.codeFrame.linesBelow).toBe(3);
    });
  });

  describe('stack', () => {
    it('uses preset stack mode', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.stack).toBe('full');
    });

    it('overrides preset with user value', () => {
      const result = resolveOptions({ preset: 'full', stack: 'top' });
      expect(result.stack).toBe('top');
    });

    it('allows numeric limit', () => {
      const result = resolveOptions({ stack: 10 });
      expect(result.stack).toBe(10);
    });

    it('allows disabling stack', () => {
      const result = resolveOptions({ stack: false });
      expect(result.stack).toBe(false);
    });
  });

  describe('candidateFiles', () => {
    it('disables when false', () => {
      const result = resolveOptions({ candidateFiles: false });
      expect(result.candidateFiles.enabled).toBe(false);
    });

    it('allows max override', () => {
      const result = resolveOptions({ candidateFiles: { max: 10 } });
      expect(result.candidateFiles.enabled).toBe(true);
      expect(result.candidateFiles.max).toBe(10);
    });
  });

  describe('console', () => {
    it('disables when false', () => {
      const result = resolveOptions({ console: false });
      expect(result.console.enabled).toBe(false);
    });

    it('uses preset values', () => {
      const result = resolveOptions({ preset: 'full' });
      expect(result.console.maxLogsPerTestPath).toBe(200);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ console: { maxCharsPerEntry: 1000 } });
      expect(result.console.enabled).toBe(true);
      expect(result.console.maxCharsPerEntry).toBe(1000);
      expect(result.console.maxLogsPerTestPath).toBe(10);
    });
  });

  describe('errors', () => {
    it('disables unhandled when false', () => {
      const result = resolveOptions({ errors: false });
      expect(result.errors.unhandled).toBe(false);
    });

    it('allows partial override', () => {
      const result = resolveOptions({ errors: { unhandled: false } });
      expect(result.errors.unhandled).toBe(false);
    });
  });
});
