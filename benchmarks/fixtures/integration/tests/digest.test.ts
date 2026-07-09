import { describe, expect, it } from '@rstest/core';
import { createReleaseDigest, loadDashboardSummary } from '../src';

describe('app release digest', () => {
  it('renders a stable release digest', () => {
    expect(createReleaseDigest()).toBe(
      [
        'tickets:6',
        'customer-facing:4',
        'top-owner:Mina:18',
        'reporter:coverage-html|snapshot-md',
        'highlighted:browser-channel|cli-shard|core-cache',
      ].join('\n'),
    );
  });

  it('loads the summary asynchronously', async () => {
    await expect(loadDashboardSummary()).resolves.toMatchObject({
      totalTickets: 6,
      customerFacingTickets: 4,
    });
  });
});
