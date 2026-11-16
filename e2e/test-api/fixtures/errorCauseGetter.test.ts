import { it } from '@rstest/core';

it('passes before the failure', () => {});

it('throws an error whose cause cannot be read', () => {
  const cause = {
    get message(): string {
      throw new Error('metadata unavailable');
    },
  };
  throw new Error('operation failed', { cause });
});

it('passes after the failure', () => {});
