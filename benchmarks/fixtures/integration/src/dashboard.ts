import { buildOwnerLoad } from './owners';
import { scoreTicket } from './score';
import { searchTicketIds } from './search';
import { tickets } from './tickets';
import type { DashboardSummary, TicketSeverity } from './types';

export function buildDashboardSummary(): DashboardSummary {
  const bySeverity: Record<TicketSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  let customerFacingTickets = 0;

  for (const ticket of tickets) {
    bySeverity[ticket.severity] += 1;
    if (ticket.customerFacing) {
      customerFacingTickets += 1;
    }
  }

  const highlightedTicketIds = tickets
    .filter((ticket) => scoreTicket(ticket) >= 10)
    .map((ticket) => ticket.id)
    .sort();

  return {
    totalTickets: tickets.length,
    customerFacingTickets,
    bySeverity,
    topOwners: buildOwnerLoad(tickets),
    highlightedTicketIds,
  };
}

export async function loadDashboardSummary(): Promise<DashboardSummary> {
  return buildDashboardSummary();
}

export function createReleaseDigest(): string {
  const summary = buildDashboardSummary();
  const reporterRelated = searchTicketIds(tickets, 'reporter');

  return [
    `tickets:${summary.totalTickets}`,
    `customer-facing:${summary.customerFacingTickets}`,
    `top-owner:${summary.topOwners[0]?.owner}:${summary.topOwners[0]?.load}`,
    `reporter:${reporterRelated.join('|')}`,
    `highlighted:${summary.highlightedTicketIds.join('|')}`,
  ].join('\n');
}
