import type { Ticket } from './types';

const severityWeight = {
  high: 6,
  medium: 4,
  low: 2,
} as const;

export function scoreTicket(ticket: Ticket): number {
  return (
    severityWeight[ticket.severity] +
    (ticket.customerFacing ? 3 : 0) +
    ticket.tags.length
  );
}
