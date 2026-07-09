import { scoreTicket } from './score';
import type { OwnerLoad, Ticket } from './types';

export function buildOwnerLoad(tickets: Ticket[]): OwnerLoad[] {
  const loadByOwner = new Map<string, OwnerLoad>();

  for (const ticket of tickets) {
    const existing = loadByOwner.get(ticket.owner) ?? {
      owner: ticket.owner,
      load: 0,
      ticketIds: [],
    };

    existing.load += scoreTicket(ticket);
    existing.ticketIds.push(ticket.id);
    loadByOwner.set(ticket.owner, existing);
  }

  return Array.from(loadByOwner.values())
    .map((entry) => ({
      ...entry,
      ticketIds: entry.ticketIds.sort(),
    }))
    .sort(
      (left, right) =>
        right.load - left.load || left.owner.localeCompare(right.owner),
    );
}
