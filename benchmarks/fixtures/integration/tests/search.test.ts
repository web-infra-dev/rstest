import { describe, expect, it } from '@rstest/core';
import { searchTicketIds, tickets } from '../src';

describe('app dashboard search', () => {
  it.each([
    ['reporter', ['coverage-html', 'snapshot-md']],
    ['noah', ['browser-channel', 'runner-hooks']],
    ['core', ['cli-shard', 'core-cache']],
  ])('finds tickets for %s', (query, expected) => {
    expect(searchTicketIds(tickets, query)).toEqual(expected);
  });
});
