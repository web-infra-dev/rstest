import { mergeRstestConfig, withDefaultConfig } from '../../src/config';
import { mergeWithCLIOptions } from '../../src/cli/init';

it('merges typecheck leaves and replaces include/exclude arrays', () => {
  const config = mergeRstestConfig(
    { typecheck: { enabled: true, include: ['a.ts'], tsconfig: 'test.json' } },
    { typecheck: { include: ['b.ts'] } },
  );
  expect(config.typecheck).toEqual({
    enabled: true,
    include: ['b.ts'],
    tsconfig: 'test.json',
  });
  expect(
    mergeWithCLIOptions(config, { typecheck: { only: true } }).typecheck,
  ).toEqual({
    enabled: true,
    only: true,
    include: ['b.ts'],
    tsconfig: 'test.json',
  });
  expect(
    withDefaultConfig({ typecheck: { only: true } }).typecheck.enabled,
  ).toBe(true);
});
