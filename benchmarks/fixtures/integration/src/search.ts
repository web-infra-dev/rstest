import type { Ticket } from './types';

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

export function searchTicketIds(tickets: Ticket[], query: string): string[] {
  const normalized = normalizeQuery(query);

  return tickets
    .filter((ticket) => {
      return (
        ticket.id.toLowerCase().includes(normalized) ||
        ticket.owner.toLowerCase().includes(normalized) ||
        ticket.tags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    })
    .map((ticket) => ticket.id)
    .sort();
}
