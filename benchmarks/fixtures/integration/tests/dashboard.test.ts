import { describe, expect, it } from '@rstest/core';
import { buildDashboardSummary } from '../src';

describe('app dashboard summary', () => {
  it('builds the release summary from project tickets', () => {
    expect(buildDashboardSummary()).toEqual({
      totalTickets: 6,
      customerFacingTickets: 4,
      bySeverity: {
        high: 2,
        medium: 2,
        low: 2,
      },
      topOwners: [
        {
          owner: 'Mina',
          load: 18,
          ticketIds: ['core-cache', 'snapshot-md'],
        },
        {
          owner: 'Noah',
          load: 17,
          ticketIds: ['browser-channel', 'runner-hooks'],
        },
        {
          owner: 'Kai',
          load: 10,
          ticketIds: ['cli-shard'],
        },
        {
          owner: 'June',
          load: 4,
          ticketIds: ['coverage-html'],
        },
      ],
      highlightedTicketIds: ['browser-channel', 'cli-shard', 'core-cache'],
    });
  });
});
