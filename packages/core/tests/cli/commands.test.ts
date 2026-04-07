import { describe, expect, it, onTestFinished, rs } from '@rstest/core';
import { createCli, normalizeCliFilters } from '../../src/cli/commands';

const renderHelp = (argv: string[]): string => {
  const logs: string[] = [];

  rs.spyOn(console, 'info').mockImplementation((...args) => {
    logs.push(args.join(' '));
  });

  onTestFinished(() => {
    rs.resetAllMocks();
  });

  createCli().parse(argv, { run: false });

  return logs.join('\n');
};

describe('CLI help output', () => {
  it('shows only init-specific options for init help', () => {
    const help = renderHelp(['node', 'rstest', 'init', '--help']);

    expect(help).toContain('--yes');
    expect(help).not.toContain('--coverage');
    expect(help).not.toContain('--reporter');
    expect(help).not.toContain('--browser');
  });

  it('shows only merge-reports options for merge-reports help', () => {
    const help = renderHelp(['node', 'rstest', 'merge-reports', '--help']);

    expect(help).toContain('--cleanup');
    expect(help).toContain('--coverage');
    expect(help).toContain('--reporter');
    expect(help).toContain('--config-loader');
    expect(help).not.toContain('--browser');
    expect(help).not.toContain('--update');
    expect(help).not.toContain('--testTimeout');
  });

  it('rejects unrelated runtime options for init', () => {
    const cli = createCli();

    expect(() =>
      cli.parse(['node', 'rstest', 'init', '--coverage'], { run: true }),
    ).toThrow('Unknown option `--coverage`');
  });
});

describe('normalizeCliFilters', () => {
  it('coerces numeric filters to strings before normalizing them', () => {
    expect(normalizeCliFilters([1, 'tests\\foo.test.ts'])).toEqual([
      '1',
      'tests/foo.test.ts',
    ]);
  });
});
