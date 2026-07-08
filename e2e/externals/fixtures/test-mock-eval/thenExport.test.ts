import { expect, it, rs } from '@rstest/core';
import * as actual from 'cjs-shaped' with { rstest: 'importActual' };
import { added, then } from 'cjs-shaped';

// `then` reads are masked only until the factory materializes (the async-deps
// machinery thenable-probes every dep); afterwards a genuine `then` export is
// served like any other, matching the eager path.
rs.mock('cjs-shaped', () => ({
  ...actual,
  added: 'MOCKED',
  then: () => 'THEN',
}));

it('should expose a genuine then export once materialized', () => {
  expect(added).toBe('MOCKED');
  expect(typeof then).toBe('function');
  expect((then as () => string)()).toBe('THEN');
});
