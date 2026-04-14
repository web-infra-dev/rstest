import { describe, expect, it } from '@rstest/core';
import { getStepSummaryDisplayPath } from '../../src/reporter/githubActions';

describe('getStepSummaryDisplayPath', () => {
  it('uses a placeholder for the workspace root', () => {
    expect(
      getStepSummaryDisplayPath(
        '/home/runner/work/rstest/rstest',
        '/home/runner/work/rstest/rstest',
      ),
    ).toBe('<ROOT>');
  });

  it('returns a workspace-relative path for nested directories', () => {
    expect(
      getStepSummaryDisplayPath(
        '/home/runner/work/rstest/rstest/examples/node',
        '/home/runner/work/rstest/rstest',
      ),
    ).toBe('examples/node');
  });

  it('normalizes Windows separators and drive letter casing', () => {
    expect(
      getStepSummaryDisplayPath(
        'D:/a/rstest/rstest/examples/node',
        'd:\\a\\rstest\\rstest',
      ),
    ).toBe('examples/node');

    expect(
      getStepSummaryDisplayPath(
        'D:\\a\\rstest\\rstest\\examples\\react-rsbuild',
        'd:/a/rstest/rstest',
      ),
    ).toBe('examples/react-rsbuild');
  });

  it('falls back to the normalized absolute path outside the workspace', () => {
    expect(
      getStepSummaryDisplayPath(
        'D:\\external\\rstest\\examples\\node',
        'd:/a/rstest/rstest',
      ),
    ).toBe('D:/external/rstest/examples/node');
  });
});
